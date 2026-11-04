"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SileroVadAdapter = void 0;
const common_1 = require("@nestjs/common");
const voice_provider_util_1 = require("../voice-provider.util");
let SileroVadAdapter = class SileroVadAdapter {
    engineId = 'silero-vad';
    endpoint = new URL('/predict', (0, voice_provider_util_1.readLoopbackUrl)('VOICE_VAD_URL', 'http://127.0.0.1:8002'));
    async detect(request) {
        if (request.audio.data.length !== 640)
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        const response = await (0, voice_provider_util_1.fetchWithTimeout)(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                streamId: request.streamId,
                audio: request.audio.data.toString('base64'),
                encoding: 'pcm_s16le',
                sampleRate: 16000,
                channels: 1,
            }),
            signal: request.signal,
        }, 500);
        if (!response.ok)
            throw new voice_provider_util_1.VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        if (!isRecord(payload) || typeof payload.speech !== 'boolean' ||
            typeof payload.probability !== 'number' || payload.probability < 0 ||
            payload.probability > 1) {
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        return { speech: payload.speech, probability: payload.probability };
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
exports.SileroVadAdapter = SileroVadAdapter;
exports.SileroVadAdapter = SileroVadAdapter = __decorate([
    (0, common_1.Injectable)()
], SileroVadAdapter);
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
//# sourceMappingURL=silero-vad.adapter.js.map