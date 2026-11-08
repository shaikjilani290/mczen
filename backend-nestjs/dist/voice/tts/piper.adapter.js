"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PiperAdapter = void 0;
const common_1 = require("@nestjs/common");
const voice_provider_util_1 = require("../voice-provider.util");
const PIPER_VOICES = {
    en: [
        { id: 'en_US-amy-medium', label: 'Amy', gender: 'female', language: 'en' },
        { id: 'en_US-lessac-medium', label: 'Lessac', gender: 'male', language: 'en' },
        { id: 'en_GB-alan-medium', label: 'Alan', gender: 'male', language: 'en' },
        { id: 'en_GB-alba-medium', label: 'Alba', gender: 'female', language: 'en' },
    ],
    hi: [
        { id: 'hi_IN-pratham-medium', label: 'Pratham', gender: 'male', language: 'hi' },
        { id: 'hi_IN-priyamvada-medium', label: 'Priyamvada', gender: 'female', language: 'hi' },
    ],
    te: [],
};
const MAX_TTS_BYTES = 1_920_000;
let PiperAdapter = class PiperAdapter {
    engineId = 'piper';
    endpoint = new URL('/synthesize', (0, voice_provider_util_1.readLoopbackUrl)('VOICE_TTS_URL', 'http://127.0.0.1:8003'));
    slots = new voice_provider_util_1.Semaphore(2, 8);
    supports(language) {
        return PIPER_VOICES[language].length > 0;
    }
    supportsVoice(language, voice) {
        return PIPER_VOICES[language].some((option) => option.id === voice);
    }
    voices(language) {
        return PIPER_VOICES[language];
    }
    async *synthesize(request) {
        if (!this.supports(request.language) || !this.supportsVoice(request.language, request.voice) ||
            request.text.trim().length === 0 || request.text.length > 2_000 ||
            !Number.isFinite(request.rate) || request.rate < 0.5 || request.rate > 2) {
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        const limit = Math.floor(120 * Math.min(request.rate, 1));
        let text = request.text.trim();
        while (text.length > limit) {
            const space = text.lastIndexOf(' ', limit);
            const boundary = space > 0 ? space : limit;
            yield* this.synthesizeSegment({ ...request, text: text.slice(0, boundary) });
            text = text.slice(boundary).trimStart();
        }
        if (text)
            yield* this.synthesizeSegment({ ...request, text });
    }
    async *synthesizeSegment(request) {
        const release = await this.slots.acquire(request.signal);
        let reader;
        try {
            const response = await (0, voice_provider_util_1.fetchWithTimeout)(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/x-mczen-pcm' },
                body: JSON.stringify({
                    text: request.text,
                    language: request.language,
                    voice: request.voice,
                    rate: request.rate,
                    encoding: 'pcm_s16le',
                    sampleRate: 16000,
                    stream: true,
                }),
                signal: request.signal,
            }, 12_000);
            if (!response.ok || !response.body)
                throw new voice_provider_util_1.VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
            const encoding = response.headers.get('x-audio-encoding');
            const sampleRate = Number(response.headers.get('x-audio-sample-rate'));
            if (encoding !== 'pcm_s16le' || sampleRate !== 16000) {
                await response.body.cancel();
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            reader = response.body.getReader();
            let total = 0;
            let carry = Buffer.alloc(0);
            while (true) {
                if (request.signal.aborted)
                    throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_TIMEOUT');
                const { done, value } = await this.readChunk(reader, request.signal);
                if (done)
                    break;
                total += value.byteLength;
                if (total > MAX_TTS_BYTES)
                    throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
                const data = Buffer.concat([carry, Buffer.from(value)]);
                const evenLength = data.length & ~1;
                if (evenLength > 0) {
                    yield {
                        encoding: 'pcm_s16le',
                        sampleRate: 16000,
                        data: data.subarray(0, evenLength),
                    };
                }
                carry = data.subarray(evenLength);
            }
            if (carry.length)
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        finally {
            if (reader) {
                await reader.cancel().catch(() => undefined);
                reader.releaseLock();
            }
            release();
        }
    }
    async readChunk(reader, signal) {
        let rejectWait = () => { };
        const cancelled = new Promise((_resolve, reject) => { rejectWait = reject; });
        const onAbort = () => rejectWait(new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_TIMEOUT'));
        signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(onAbort, 12_000);
        if (signal.aborted)
            onAbort();
        try {
            return await Promise.race([reader.read(), cancelled]);
        }
        finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
        }
    }
    async healthCheck() {
        try {
            const response = await (0, voice_provider_util_1.fetchWithTimeout)(new URL('/health', this.endpoint), { method: 'GET' }, 1500);
            return response.ok;
        }
        catch {
            return false;
        }
    }
};
exports.PiperAdapter = PiperAdapter;
exports.PiperAdapter = PiperAdapter = __decorate([
    (0, common_1.Injectable)()
], PiperAdapter);
//# sourceMappingURL=piper.adapter.js.map