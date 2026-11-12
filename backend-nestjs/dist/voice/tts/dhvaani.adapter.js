"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DhvaaniAdapter = void 0;
const common_1 = require("@nestjs/common");
const voice_provider_util_1 = require("../voice-provider.util");
const DHVAANI_VOICES = {
    en: [{ id: 'my_voice', label: 'My Voice', gender: 'male', language: 'en' }],
    hi: [{ id: 'my_voice', label: 'My Voice', gender: 'male', language: 'hi' }],
    te: [{ id: 'my_voice', label: 'My Voice', gender: 'male', language: 'te' }],
};
const MAX_AUDIO_BYTES = 5_000_000;
const SOURCE_SAMPLE_RATE = 24_000;
const TARGET_SAMPLE_RATE = 16_000;
let DhvaaniAdapter = class DhvaaniAdapter {
    engineId = 'dhvaani';
    baseUrl = (0, voice_provider_util_1.readLoopbackUrl)('DHVAANI_TTS_URL', 'http://127.0.0.1:8003');
    slots = new voice_provider_util_1.Semaphore(1, 4);
    supports(language) {
        return DHVAANI_VOICES[language]?.length > 0;
    }
    supportsVoice(language, voice) {
        return DHVAANI_VOICES[language]?.some((item) => item.id === voice) ?? false;
    }
    voices(language) {
        return DHVAANI_VOICES[language] ?? [];
    }
    async *synthesize(request) {
        if (!this.supports(request.language) ||
            !this.supportsVoice(request.language, request.voice) ||
            !request.text.trim() ||
            request.text.length > 2_000 ||
            !Number.isFinite(request.rate) ||
            request.rate < 0.5 ||
            request.rate > 2) {
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        const release = await this.slots.acquire(request.signal);
        try {
            const response = await (0, voice_provider_util_1.fetchWithTimeout)(new URL('/tts/generate', this.baseUrl), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
                body: JSON.stringify({
                    text: request.text.trim(),
                    voice_id: request.voice,
                    language: request.language,
                }),
                signal: request.signal,
            }, 60_000);
            if (!response.ok) {
                throw new voice_provider_util_1.VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
            }
            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.includes('audio/wav')) {
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            const audio = Buffer.from(await response.arrayBuffer());
            if (audio.length > MAX_AUDIO_BYTES) {
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            const pcm = this.convertWavToPcm16k(audio);
            if (pcm.length === 0) {
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            yield {
                encoding: 'pcm_s16le',
                sampleRate: TARGET_SAMPLE_RATE,
                data: pcm,
            };
        }
        finally {
            release();
        }
    }
    convertWavToPcm16k(wav) {
        if (wav.length < 44 ||
            wav.toString('ascii', 0, 4) !== 'RIFF' ||
            wav.toString('ascii', 8, 12) !== 'WAVE') {
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        let offset = 12;
        let channels = 0;
        let sampleRate = 0;
        let bitsPerSample = 0;
        let audioFormat = 0;
        let pcmData;
        while (offset + 8 <= wav.length) {
            const chunkId = wav.toString('ascii', offset, offset + 4);
            const chunkSize = wav.readUInt32LE(offset + 4);
            const start = offset + 8;
            const end = start + chunkSize;
            if (end > wav.length) {
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            if (chunkId === 'fmt ') {
                if (chunkSize < 16) {
                    throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
                }
                audioFormat = wav.readUInt16LE(start);
                channels = wav.readUInt16LE(start + 2);
                sampleRate = wav.readUInt32LE(start + 4);
                bitsPerSample = wav.readUInt16LE(start + 14);
            }
            if (chunkId === 'data') {
                pcmData = wav.subarray(start, end);
            }
            offset = end + (chunkSize & 1);
        }
        if (audioFormat !== 1 ||
            sampleRate !== SOURCE_SAMPLE_RATE ||
            bitsPerSample !== 16 ||
            channels < 1 ||
            channels > 2 ||
            !pcmData ||
            pcmData.length % (channels * 2) !== 0) {
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        const inputFrames = pcmData.length / (channels * 2);
        const outputFrames = Math.floor((inputFrames * TARGET_SAMPLE_RATE) / SOURCE_SAMPLE_RATE);
        const output = Buffer.alloc(outputFrames * 2);
        const ratio = SOURCE_SAMPLE_RATE / TARGET_SAMPLE_RATE;
        const readMonoSample = (frame) => {
            let total = 0;
            for (let channel = 0; channel < channels; channel++) {
                total += pcmData.readInt16LE((frame * channels + channel) * 2);
            }
            return total / channels;
        };
        for (let i = 0; i < outputFrames; i++) {
            const position = i * ratio;
            const left = Math.floor(position);
            const right = Math.min(left + 1, inputFrames - 1);
            const fraction = position - left;
            const value = readMonoSample(left) * (1 - fraction) +
                readMonoSample(right) * fraction;
            output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), i * 2);
        }
        return output;
    }
    async healthCheck() {
        try {
            const response = await (0, voice_provider_util_1.fetchWithTimeout)(new URL('/health', this.baseUrl), { method: 'GET' }, 2_000);
            if (!response.ok)
                return false;
            const result = (await response.json());
            return result.status === 'ok' && result.model_loaded === true;
        }
        catch {
            return false;
        }
    }
};
exports.DhvaaniAdapter = DhvaaniAdapter;
exports.DhvaaniAdapter = DhvaaniAdapter = __decorate([
    (0, common_1.Injectable)()
], DhvaaniAdapter);
//# sourceMappingURL=dhvaani.adapter.js.map