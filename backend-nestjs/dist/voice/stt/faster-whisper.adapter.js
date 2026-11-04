"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FasterWhisperAdapter = void 0;
const common_1 = require("@nestjs/common");
const voice_provider_util_1 = require("../voice-provider.util");
const LANGUAGES = new Set(['en', 'hi', 'te']);
let FasterWhisperAdapter = class FasterWhisperAdapter {
    engineId = process.env.VOICE_STT_ENGINE_ID ?? 'faster-whisper-small-int8';
    endpoint = new URL('/transcribe', (0, voice_provider_util_1.readLoopbackUrl)('VOICE_STT_URL', 'http://127.0.0.1:8001'));
    slots = new voice_provider_util_1.Semaphore(2, 8);
    transcribe(request) {
        if (request.audio.data.length < 640 || request.audio.data.length > 640_000 ||
            request.audio.data.length % 2 !== 0) {
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        return this.slots.run(async () => {
            const form = new FormData();
            form.append('file', new Blob([new Uint8Array(request.audio.data)], { type: 'application/octet-stream' }), 'audio.pcm');
            form.append('encoding', 'pcm_s16le');
            form.append('sample_rate', '16000');
            form.append('channels', '1');
            form.append('partial', String(request.partial));
            form.append('model', this.engineId);
            if (request.language !== 'auto')
                form.append('language', request.language);
            const response = await (0, voice_provider_util_1.fetchWithTimeout)(this.endpoint, {
                method: 'POST',
                body: form,
                signal: request.signal,
            }, request.partial ? 12_000 : 45_000);
            if (!response.ok)
                throw new voice_provider_util_1.VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
            let payload;
            try {
                payload = await response.json();
            }
            catch {
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            if (!isRecord(payload) || typeof payload.text !== 'string' ||
                payload.text.length > 8_000 || typeof payload.language !== 'string' ||
                !LANGUAGES.has(payload.language)) {
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            const confidence = payload.confidence;
            if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) {
                throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            return {
                text: payload.text,
                language: payload.language,
                confidence: confidence,
                isFinal: !request.partial,
            };
        });
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
exports.FasterWhisperAdapter = FasterWhisperAdapter;
exports.FasterWhisperAdapter = FasterWhisperAdapter = __decorate([
    (0, common_1.Injectable)()
], FasterWhisperAdapter);
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
//# sourceMappingURL=faster-whisper.adapter.js.map