"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var VoiceLibraryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceLibraryService = exports.MAX_VOICE_UPLOAD = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const node_crypto_1 = require("node:crypto");
const tenant_context_store_1 = require("../common/tenant/tenant-context.store");
const uuid_1 = require("../common/ids/uuid");
const voice_provider_util_1 = require("./voice-provider.util");
const execute = (0, node_util_1.promisify)(node_child_process_1.execFile);
exports.MAX_VOICE_UPLOAD = 20 * 1024 * 1024;
let VoiceLibraryService = VoiceLibraryService_1 = class VoiceLibraryService {
    root = (0, node_path_1.resolve)(process.env.VOICE_STORAGE_DIR || (0, node_path_1.join)(process.cwd(), 'storage', 'voices'));
    logger = new common_1.Logger(VoiceLibraryService_1.name);
    jobs = new Map();
    slots = new voice_provider_util_1.Semaphore(1, 2);
    tenant() {
        if (process.env.NODE_ENV === 'production')
            throw new common_1.ServiceUnavailableException('The local voice library is development-only. Production profile persistence has not been configured.');
        const tenant = tenant_context_store_1.tenantContextStore.getOrThrow();
        if (tenant.actorType !== 'user' || !(0, uuid_1.isUuidv7)(tenant.tenantId))
            throw new common_1.BadRequestException('An authenticated tenant administrator is required.');
        return tenant.tenantId;
    }
    directory(tenant, id) {
        if (!(0, uuid_1.isUuidv7)(tenant) || !/^[0-9a-f-]{36}$/.test(id))
            throw new common_1.NotFoundException('Voice not found.');
        return (0, node_path_1.join)(this.root, tenant, id);
    }
    async save(tenant, profile) {
        const dir = this.directory(tenant, profile.id);
        const temporary = (0, node_path_1.join)(dir, `profile-${(0, node_crypto_1.randomUUID)()}.tmp`);
        try {
            await node_fs_1.promises.writeFile(temporary, JSON.stringify(profile), { mode: 0o600 });
            await node_fs_1.promises.rename(temporary, (0, node_path_1.join)(dir, 'profile.json'));
        }
        finally {
            await node_fs_1.promises.rm(temporary, { force: true });
        }
    }
    async onModuleDestroy() { await Promise.all(this.jobs.values()); }
    async list() {
        const tenant = this.tenant();
        let entries;
        try {
            entries = await node_fs_1.promises.readdir((0, node_path_1.join)(this.root, tenant));
        }
        catch (error) {
            if (isMissing(error))
                return { items: [], providerConfigured: !!process.env.VOICE_CLONE_URL };
            throw error;
        }
        const items = await Promise.all(entries.map((id) => this.getForTenant(tenant, id)));
        return { items, providerConfigured: !!process.env.VOICE_CLONE_URL };
    }
    async getForTenant(tenant, id) {
        try {
            const profile = JSON.parse(await node_fs_1.promises.readFile((0, node_path_1.join)(this.directory(tenant, id), 'profile.json'), 'utf8'));
            if (profile.state === 'processing' && !this.jobs.has(id)) {
                profile.state = 'failed';
                profile.error = 'Processing was interrupted. Retry this voice.';
                await this.save(tenant, profile);
            }
            return profile;
        }
        catch (error) {
            if (isMissing(error))
                throw new common_1.NotFoundException('Voice not found.');
            throw error;
        }
    }
    get(id) { return this.getForTenant(this.tenant(), id); }
    async create(file, body, userId) {
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new common_1.BadRequestException('Invalid voice metadata.');
        const input = body;
        if (Object.keys(input).some((key) => !['name', 'language', 'consent'].includes(key)) ||
            typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 ||
            input.language !== 'en' || ![true, 'true'].includes(input.consent)) {
            throw new common_1.BadRequestException('Enter a voice name, English language and explicit recording ownership/permission consent.');
        }
        if (!file || file.size !== file.buffer.length || file.size === 0 || file.size > exports.MAX_VOICE_UPLOAD ||
            !['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'audio/x-m4a'].includes(file.mimetype)) {
            throw new common_1.BadRequestException('Upload a WAV, MP3 or M4A/MP4 recording up to 20 MB.');
        }
        const tenant = this.tenant();
        const profile = {
            id: (0, node_crypto_1.randomUUID)(), name: input.name.trim(), language: 'en', provider: 'openvoice-v2', state: 'uploaded',
            createdBy: userId, createdAt: new Date().toISOString(), consent: true, error: null,
        };
        const dir = this.directory(tenant, profile.id);
        await node_fs_1.promises.mkdir(dir, { recursive: true, mode: 0o700 });
        await node_fs_1.promises.writeFile((0, node_path_1.join)(dir, 'original'), file.buffer, { mode: 0o600 });
        await this.save(tenant, profile);
        return profile;
    }
    async process(id) {
        const tenant = this.tenant();
        const profile = await this.get(id);
        if (this.jobs.has(id))
            return profile;
        if (profile.state === 'active')
            throw new common_1.BadRequestException('Deactivate the voice before processing.');
        if (!process.env.VOICE_CLONE_URL)
            throw new common_1.ServiceUnavailableException('OpenVoice V2 provider is not configured. Original recording remains private; no clone has been generated.');
        profile.state = 'processing';
        profile.error = null;
        const job = Promise.resolve().then(async () => {
            await this.save(tenant, profile);
            await this.slots.run(() => this.prepare(tenant, profile));
        }).catch(async (error) => {
            profile.state = 'failed';
            profile.error = error instanceof common_1.BadRequestException ? error.message : 'Audio preparation or cloning provider failed. Check the voice provider and FFmpeg installation.';
            this.logger.warn({ event: 'voice_profile_failed', voiceId: id, reason: error instanceof common_1.BadRequestException ? 'invalid_audio' : 'provider_or_processing_failed' });
            try {
                await this.save(tenant, profile);
            }
            catch {
                this.logger.error({ event: 'voice_profile_failure_persistence_failed', voiceId: id });
            }
        }).finally(() => { this.jobs.delete(id); });
        this.jobs.set(id, job);
        return { ...profile };
    }
    endpoint(path) {
        if (!process.env.VOICE_CLONE_URL)
            throw new common_1.ServiceUnavailableException('Voice-cloning provider is not configured.');
        return new URL(path, (0, voice_provider_util_1.readLoopbackUrl)('VOICE_CLONE_URL', 'http://127.0.0.1:8004'));
    }
    async prepare(tenant, profile) {
        const dir = this.directory(tenant, profile.id);
        const original = (0, node_path_1.join)(dir, 'original');
        const { stdout } = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', original], { timeout: 15_000, maxBuffer: 32_000 });
        const metadata = JSON.parse(stdout);
        const duration = Number(metadata.format?.duration);
        if (!metadata.streams?.some((stream) => stream.codec_type === 'audio') || !Number.isFinite(duration) || duration < 6 || duration > 120) {
            throw new common_1.BadRequestException('Reference must contain 6–120 seconds of audio; 30–60 seconds of clean speech is recommended.');
        }
        const wav = (0, node_path_1.join)(dir, 'prepared.wav');
        await execute('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', original,
            '-vn', '-t', '120', '-ac', '1', '-ar', '16000', '-af', 'loudnorm=I=-20:TP=-2:LRA=7', '-c:a', 'pcm_s16le', '-y', wav], { timeout: 30_000, maxBuffer: 32_000 });
        const raw = await node_fs_1.promises.readFile(wav);
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(raw)], { type: 'audio/wav' }), 'reference.wav');
        await (0, voice_provider_util_1.fetchWithTimeout)(this.endpoint('/profiles'), { method: 'POST', body: form, redirect: 'error' }, 120_000, async (response) => {
            if (!response.ok)
                throw new common_1.ServiceUnavailableException('Voice-cloning provider rejected the recording.');
            const result = JSON.parse((await limitedBody(response, 4096)).toString('utf8'));
            if (typeof result.embedding !== 'string' || result.embedding.length !== 1368 ||
                !/^[A-Za-z0-9+/]+={0,2}$/.test(result.embedding))
                throw new common_1.ServiceUnavailableException('Invalid speaker profile response.');
            const embedding = Buffer.from(result.embedding, 'base64');
            if (embedding.length !== 1024 || embedding.toString('base64') !== result.embedding ||
                Array.from({ length: 256 }, (_, i) => embedding.readFloatLE(i * 4)).some((value) => !Number.isFinite(value))) {
                throw new common_1.ServiceUnavailableException('Invalid speaker profile values.');
            }
            await node_fs_1.promises.writeFile((0, node_path_1.join)(dir, 'speaker.bin'), embedding, { mode: 0o600 });
        });
        profile.state = 'ready';
        await this.save(tenant, profile);
    }
    async setActive(id, active) {
        const tenant = this.tenant();
        const profile = await this.get(id);
        if (!['ready', 'active', 'inactive'].includes(profile.state))
            throw new common_1.BadRequestException('Process and preview this voice before activation.');
        if (active) {
            try {
                await node_fs_1.promises.access((0, node_path_1.join)(this.directory(tenant, id), 'preview.wav'));
            }
            catch (error) {
                if (isMissing(error))
                    throw new common_1.BadRequestException('Generate and listen to a preview before activation.');
                throw error;
            }
        }
        profile.state = active ? 'active' : 'inactive';
        await this.save(tenant, profile);
        return profile;
    }
    async preview(id, text) {
        const tenant = this.tenant();
        const profile = await this.get(id);
        if (!['ready', 'active', 'inactive'].includes(profile.state) || !text.trim() || text.length > 500)
            throw new common_1.BadRequestException('A ready voice and 1–500 characters of preview text are required.');
        const audio = await this.render(tenant, id, text);
        await node_fs_1.promises.writeFile((0, node_path_1.join)(this.directory(tenant, id), 'preview.wav'), audio, { mode: 0o600 });
        return audio;
    }
    async render(tenant, id, text, signal) {
        const embedding = (await node_fs_1.promises.readFile((0, node_path_1.join)(this.directory(tenant, id), 'speaker.bin'))).toString('base64');
        const audio = await (0, voice_provider_util_1.fetchWithTimeout)(this.endpoint('/convert'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embedding, text, language: 'en' }), signal, redirect: 'error',
        }, 60_000, async (response) => {
            if (!response.ok)
                throw new common_1.ServiceUnavailableException('Voice preview generation failed.');
            const bytes = await limitedBody(response, 2_000_000);
            if (bytes.length < 44 || bytes.length > 2_000_000 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
                bytes.toString('ascii', 8, 12) !== 'WAVE')
                throw new common_1.ServiceUnavailableException('Invalid preview audio.');
            return bytes;
        });
        return audio;
    }
    async activeForTenant(tenant) {
        if (process.env.NODE_ENV === 'production')
            return [];
        this.directory(tenant, '00000000-0000-0000-0000-000000000000');
        let entries;
        try {
            entries = await node_fs_1.promises.readdir((0, node_path_1.join)(this.root, tenant));
        }
        catch (error) {
            if (isMissing(error))
                return [];
            throw error;
        }
        const profiles = await Promise.all(entries.map((id) => this.getForTenant(tenant, id)));
        const active = profiles.filter((profile) => profile.state === 'active');
        if (active.length && !await this.healthCheck()) {
            this.logger.warn({ event: 'voice_clone_provider_unavailable' });
            return [];
        }
        return active.map((profile) => ({
            id: `clone:${profile.id}`, label: profile.name, language: profile.language, provider: profile.provider,
        }));
    }
    async assertActive(tenant, voice, language) {
        if (process.env.NODE_ENV === 'production')
            throw new common_1.ServiceUnavailableException('Production voice profile persistence is not configured.');
        const profile = await this.getForTenant(tenant, voice.slice('clone:'.length));
        if (!voice.startsWith('clone:') || profile.state !== 'active' || profile.language !== language) {
            throw new common_1.BadRequestException('The selected voice is unavailable for this tenant or language.');
        }
        if (!await this.healthCheck())
            throw new common_1.ServiceUnavailableException('The selected voice provider is unavailable. Select the assistant default voice.');
    }
    async healthCheck() {
        if (!process.env.VOICE_CLONE_URL)
            return false;
        try {
            return await (0, voice_provider_util_1.fetchWithTimeout)(this.endpoint('/health'), { redirect: 'error' }, 1000, async (response) => {
                if (!response.ok)
                    return false;
                const body = JSON.parse((await limitedBody(response, 4096)).toString('utf8'));
                return body.healthy === true && body.service === 'openvoice-v2';
            });
        }
        catch {
            this.logger.warn({ event: 'voice_clone_health_probe_failed' });
            return false;
        }
    }
    async *synthesize(tenant, request) {
        if (request.signal.aborted)
            return;
        await this.assertActive(tenant, request.voice, request.language);
        if (request.text.length > 500)
            throw new common_1.BadRequestException('Cloned speech segments cannot exceed 500 characters.');
        const audio = await this.render(tenant, request.voice.slice(6), request.text, request.signal);
        if (request.signal.aborted)
            return;
        const dir = await node_fs_1.promises.mkdtemp((0, node_path_1.join)(this.root, 'playback-'));
        try {
            const input = (0, node_path_1.join)(dir, 'speech.wav');
            const output = (0, node_path_1.join)(dir, 'speech.pcm');
            await node_fs_1.promises.writeFile(input, audio, { mode: 0o600 });
            await execute('ffmpeg', ['-nostdin', '-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000',
                ...(request.rate === 1 ? [] : ['-af', `atempo=${Math.min(2, Math.max(0.5, request.rate))}`]), '-f', 's16le', output], { timeout: 15_000, signal: request.signal, maxBuffer: 32_000 });
            const pcm = await node_fs_1.promises.readFile(output);
            if (!pcm.length || pcm.length > 1_920_000 || pcm.length % 2)
                throw new common_1.ServiceUnavailableException('Invalid cloned speech audio.');
            for (let offset = 0; offset < pcm.length; offset += 6400) {
                if (request.signal.aborted)
                    return;
                yield { encoding: 'pcm_s16le', sampleRate: 16000, data: pcm.subarray(offset, offset + 6400) };
            }
        }
        finally {
            await node_fs_1.promises.rm((0, node_path_1.join)(dir, 'speech.wav'), { force: true });
            await node_fs_1.promises.rm((0, node_path_1.join)(dir, 'speech.pcm'), { force: true });
            await node_fs_1.promises.rmdir(dir);
        }
    }
    async remove(id) {
        const tenant = this.tenant();
        const profile = await this.get(id);
        if (this.jobs.has(id) || profile.state === 'active')
            throw new common_1.BadRequestException('Deactivate the voice and wait for processing before deletion.');
        const dir = this.directory(tenant, id);
        for (const name of ['profile.json', 'profile.tmp', 'original', 'prepared.wav', 'speaker.bin', 'preview.wav'])
            await node_fs_1.promises.rm((0, node_path_1.join)(dir, name), { force: true });
        await node_fs_1.promises.rmdir(dir);
        return { deleted: true };
    }
};
exports.VoiceLibraryService = VoiceLibraryService;
exports.VoiceLibraryService = VoiceLibraryService = VoiceLibraryService_1 = __decorate([
    (0, common_1.Injectable)()
], VoiceLibraryService);
function isMissing(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
async function limitedBody(response, maxBytes) {
    if (!response.body)
        throw new common_1.ServiceUnavailableException('Voice provider returned an empty body.');
    const reader = response.body.getReader();
    const buffers = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                return Buffer.concat(buffers, total);
            total += value.byteLength;
            if (total > maxBytes)
                throw new common_1.ServiceUnavailableException('Voice provider exceeded the response limit.');
            buffers.push(Buffer.from(value));
        }
    }
    finally {
        await reader.cancel();
        reader.releaseLock();
    }
}
//# sourceMappingURL=voice-library.service.js.map