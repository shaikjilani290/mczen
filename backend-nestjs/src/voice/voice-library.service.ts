import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { tenantContextStore } from '../common/tenant/tenant-context.store';
import { isUuidv7 } from '../common/ids/uuid';
import { readLoopbackUrl, fetchWithTimeout, Semaphore } from './voice-provider.util';
import type { TtsAudioChunk, TtsRequest } from './tts/tts.port';

const execute = promisify(execFile);
export const MAX_VOICE_UPLOAD = 20 * 1024 * 1024;
type State = 'uploaded' | 'processing' | 'ready' | 'failed' | 'active' | 'inactive';
export interface VoiceProfile {
  id: string; name: string; language: 'en'; provider: 'openvoice-v2'; state: State;
  createdBy: string; createdAt: string; consent: true; error: string | null;
}

/** Private local storage, like document storage; deploy on one durable, private volume. */
@Injectable()
export class VoiceLibraryService implements OnModuleDestroy {
  private readonly root = resolve(process.env.VOICE_STORAGE_DIR || join(process.cwd(), 'storage', 'voices'));
  private readonly logger = new Logger(VoiceLibraryService.name);
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly slots = new Semaphore(1, 2);

  private tenant() {
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('The local voice library is development-only. Production profile persistence has not been configured.');
    const tenant = tenantContextStore.getOrThrow();
    if (tenant.actorType !== 'user' || !isUuidv7(tenant.tenantId)) throw new BadRequestException('An authenticated tenant administrator is required.');
    return tenant.tenantId;
  }
  private directory(tenant: string, id: string) {
    if (!isUuidv7(tenant) || !/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException('Voice not found.');
    return join(this.root, tenant, id);
  }
  private async save(tenant: string, profile: VoiceProfile) {
    const dir = this.directory(tenant, profile.id);
    const temporary = join(dir, `profile-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify(profile), { mode: 0o600 });
      await fs.rename(temporary, join(dir, 'profile.json'));
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async onModuleDestroy() { await Promise.all(this.jobs.values()); }
  async list() {
    const tenant = this.tenant();
    let entries;
    try { entries = await fs.readdir(join(this.root, tenant)); }
    catch (error) { if (isMissing(error)) return { items: [], providerConfigured: !!process.env.VOICE_CLONE_URL }; throw error; }
    const items = await Promise.all(entries.map((id) => this.getForTenant(tenant, id)));
    return { items, providerConfigured: !!process.env.VOICE_CLONE_URL };
  }
  private async getForTenant(tenant: string, id: string): Promise<VoiceProfile> {
    try {
      const profile = JSON.parse(await fs.readFile(join(this.directory(tenant, id), 'profile.json'), 'utf8')) as VoiceProfile;
      if (profile.state === 'processing' && !this.jobs.has(id)) {
        profile.state = 'failed'; profile.error = 'Processing was interrupted. Retry this voice.';
        await this.save(tenant, profile);
      }
      return profile;
    } catch (error) { if (isMissing(error)) throw new NotFoundException('Voice not found.'); throw error; }
  }
  get(id: string) { return this.getForTenant(this.tenant(), id); }
  async create(file: { buffer: Buffer; mimetype: string; size: number } | undefined, body: unknown, userId: string) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid voice metadata.');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some((key) => !['name', 'language', 'consent'].includes(key)) ||
        typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 ||
        input.language !== 'en' || ![true, 'true'].includes(input.consent as boolean | string)) {
      throw new BadRequestException('Enter a voice name, English language and explicit recording ownership/permission consent.');
    }
    if (!file || file.size !== file.buffer.length || file.size === 0 || file.size > MAX_VOICE_UPLOAD ||
        !['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'audio/x-m4a'].includes(file.mimetype)) {
      throw new BadRequestException('Upload a WAV, MP3 or M4A/MP4 recording up to 20 MB.');
    }
    const tenant = this.tenant();
    const profile: VoiceProfile = {
      id: randomUUID(), name: input.name.trim(), language: 'en', provider: 'openvoice-v2', state: 'uploaded',
      createdBy: userId, createdAt: new Date().toISOString(), consent: true, error: null,
    };
    const dir = this.directory(tenant, profile.id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(join(dir, 'original'), file.buffer, { mode: 0o600 });
    await this.save(tenant, profile);
    return profile;
  }
  async process(id: string) {
    const tenant = this.tenant();
    const profile = await this.get(id);
    if (this.jobs.has(id)) return profile;
    if (profile.state === 'active') throw new BadRequestException('Deactivate the voice before processing.');
    if (!process.env.VOICE_CLONE_URL) throw new ServiceUnavailableException('OpenVoice V2 provider is not configured. Original recording remains private; no clone has been generated.');
    profile.state = 'processing'; profile.error = null;
    const job = Promise.resolve().then(async () => {
      await this.save(tenant, profile);
      await this.slots.run(() => this.prepare(tenant, profile));
    }).catch(async (error: unknown) => {
      profile.state = 'failed';
      profile.error = error instanceof BadRequestException ? error.message : 'Audio preparation or cloning provider failed. Check the voice provider and FFmpeg installation.';
      this.logger.warn({ event: 'voice_profile_failed', voiceId: id, reason: error instanceof BadRequestException ? 'invalid_audio' : 'provider_or_processing_failed' });
      try { await this.save(tenant, profile); }
      catch { this.logger.error({ event: 'voice_profile_failure_persistence_failed', voiceId: id }); }
    }).finally(() => { this.jobs.delete(id); });
    this.jobs.set(id, job);
    return { ...profile };
  }
  private endpoint(path: string) {
    if (!process.env.VOICE_CLONE_URL) throw new ServiceUnavailableException('Voice-cloning provider is not configured.');
    return new URL(path, readLoopbackUrl('VOICE_CLONE_URL', 'http://127.0.0.1:8004'));
  }
  private async prepare(tenant: string, profile: VoiceProfile) {
    const dir = this.directory(tenant, profile.id);
    const original = join(dir, 'original');
    const { stdout } = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', original], { timeout: 15_000, maxBuffer: 32_000 });
    const metadata = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type: string }> };
    const duration = Number(metadata.format?.duration);
    if (!metadata.streams?.some((stream) => stream.codec_type === 'audio') || !Number.isFinite(duration) || duration < 6 || duration > 120) {
      throw new BadRequestException('Reference must contain 6–120 seconds of audio; 30–60 seconds of clean speech is recommended.');
    }
    const wav = join(dir, 'prepared.wav');
    await execute('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', original,
      '-vn', '-t', '120', '-ac', '1', '-ar', '16000', '-af', 'loudnorm=I=-20:TP=-2:LRA=7', '-c:a', 'pcm_s16le', '-y', wav],
    { timeout: 30_000, maxBuffer: 32_000 });
    const raw = await fs.readFile(wav);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(raw)], { type: 'audio/wav' }), 'reference.wav');
    await fetchWithTimeout(this.endpoint('/profiles'), { method: 'POST', body: form, redirect: 'error' }, 120_000, async (response) => {
      if (!response.ok) throw new ServiceUnavailableException('Voice-cloning provider rejected the recording.');
      const result = JSON.parse((await limitedBody(response, 4096)).toString('utf8')) as { embedding?: unknown };
      if (typeof result.embedding !== 'string' || result.embedding.length !== 1368 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(result.embedding)) throw new ServiceUnavailableException('Invalid speaker profile response.');
      const embedding = Buffer.from(result.embedding, 'base64');
      if (embedding.length !== 1024 || embedding.toString('base64') !== result.embedding ||
          Array.from({ length: 256 }, (_, i) => embedding.readFloatLE(i * 4)).some((value) => !Number.isFinite(value))) {
        throw new ServiceUnavailableException('Invalid speaker profile values.');
      }
      await fs.writeFile(join(dir, 'speaker.bin'), embedding, { mode: 0o600 });
    });
    profile.state = 'ready'; await this.save(tenant, profile);
  }
  async setActive(id: string, active: boolean) {
    const tenant = this.tenant(); const profile = await this.get(id);
    if (!['ready', 'active', 'inactive'].includes(profile.state)) throw new BadRequestException('Process and preview this voice before activation.');
    if (active) {
      try { await fs.access(join(this.directory(tenant, id), 'preview.wav')); }
      catch (error) { if (isMissing(error)) throw new BadRequestException('Generate and listen to a preview before activation.'); throw error; }
    }
    profile.state = active ? 'active' : 'inactive'; await this.save(tenant, profile);
    return profile;
  }
  async preview(id: string, text: string) {
    const tenant = this.tenant(); const profile = await this.get(id);
    if (!['ready', 'active', 'inactive'].includes(profile.state) || !text.trim() || text.length > 500) throw new BadRequestException('A ready voice and 1–500 characters of preview text are required.');
    const audio = await this.render(tenant, id, text);
    await fs.writeFile(join(this.directory(tenant, id), 'preview.wav'), audio, { mode: 0o600 });
    return audio;
  }
  private async render(tenant: string, id: string, text: string, signal?: AbortSignal) {
    const embedding = (await fs.readFile(join(this.directory(tenant, id), 'speaker.bin'))).toString('base64');
    const audio = await fetchWithTimeout(this.endpoint('/convert'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding, text, language: 'en' }), signal, redirect: 'error',
    }, 60_000, async (response) => {
      if (!response.ok) throw new ServiceUnavailableException('Voice preview generation failed.');
      const bytes = await limitedBody(response, 2_000_000);
      if (bytes.length < 44 || bytes.length > 2_000_000 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
          bytes.toString('ascii', 8, 12) !== 'WAVE') throw new ServiceUnavailableException('Invalid preview audio.');
      return bytes;
    });
    return audio;
  }
  async activeForTenant(tenant: string) {
    if (process.env.NODE_ENV === 'production') return [];
    this.directory(tenant, '00000000-0000-0000-0000-000000000000');
    let entries: string[];
    try { entries = await fs.readdir(join(this.root, tenant)); }
    catch (error) { if (isMissing(error)) return []; throw error; }
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
  async assertActive(tenant: string, voice: string, language: string) {
    if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Production voice profile persistence is not configured.');
    const profile = await this.getForTenant(tenant, voice.slice('clone:'.length));
    if (!voice.startsWith('clone:') || profile.state !== 'active' || profile.language !== language) {
      throw new BadRequestException('The selected voice is unavailable for this tenant or language.');
    }
    if (!await this.healthCheck()) throw new ServiceUnavailableException('The selected voice provider is unavailable. Select the assistant default voice.');
  }
  private async healthCheck() {
    if (!process.env.VOICE_CLONE_URL) return false;
    try {
      return await fetchWithTimeout(this.endpoint('/health'), { redirect: 'error' }, 1000, async (response) => {
        if (!response.ok) return false;
        const body = JSON.parse((await limitedBody(response, 4096)).toString('utf8')) as Record<string, unknown>;
        return body.healthy === true && body.service === 'openvoice-v2';
      });
    } catch { this.logger.warn({ event: 'voice_clone_health_probe_failed' }); return false; }
  }
  async *synthesize(tenant: string, request: TtsRequest): AsyncIterable<TtsAudioChunk> {
    if (request.signal.aborted) return;
    await this.assertActive(tenant, request.voice, request.language);
    if (request.text.length > 500) throw new BadRequestException('Cloned speech segments cannot exceed 500 characters.');
    const audio = await this.render(tenant, request.voice.slice(6), request.text, request.signal);
    if (request.signal.aborted) return;
    const dir = await fs.mkdtemp(join(this.root, 'playback-'));
    try {
      const input = join(dir, 'speech.wav');
      const output = join(dir, 'speech.pcm');
      await fs.writeFile(input, audio, { mode: 0o600 });
      await execute('ffmpeg', ['-nostdin', '-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000',
        ...(request.rate === 1 ? [] : ['-af', `atempo=${Math.min(2, Math.max(0.5, request.rate))}`]), '-f', 's16le', output],
      { timeout: 15_000, signal: request.signal, maxBuffer: 32_000 });
      const pcm = await fs.readFile(output);
      if (!pcm.length || pcm.length > 1_920_000 || pcm.length % 2) throw new ServiceUnavailableException('Invalid cloned speech audio.');
      for (let offset = 0; offset < pcm.length; offset += 6400) {
        if (request.signal.aborted) return;
        yield { encoding: 'pcm_s16le', sampleRate: 16000, data: pcm.subarray(offset, offset + 6400) };
      }
    } finally {
      await fs.rm(join(dir, 'speech.wav'), { force: true });
      await fs.rm(join(dir, 'speech.pcm'), { force: true });
      await fs.rmdir(dir);
    }
  }
  async remove(id: string) {
    const tenant = this.tenant(); const profile = await this.get(id);
    if (this.jobs.has(id) || profile.state === 'active') throw new BadRequestException('Deactivate the voice and wait for processing before deletion.');
    const dir = this.directory(tenant, id);
    for (const name of ['profile.json', 'profile.tmp', 'original', 'prepared.wav', 'speaker.bin', 'preview.wav']) await fs.rm(join(dir, name), { force: true });
    await fs.rmdir(dir);
    return { deleted: true };
  }
}
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
async function limitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new ServiceUnavailableException('Voice provider returned an empty body.');
  const reader = response.body.getReader();
  const buffers: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(buffers, total);
      total += value.byteLength;
      if (total > maxBytes) throw new ServiceUnavailableException('Voice provider exceeded the response limit.');
      buffers.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}
