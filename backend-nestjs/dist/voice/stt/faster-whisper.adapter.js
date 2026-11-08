"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var FasterWhisperAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FasterWhisperAdapter = void 0;
exports.isRecognitionQuality = isRecognitionQuality;
const common_1 = require("@nestjs/common");
const voice_provider_util_1 = require("../voice-provider.util");
const LANGUAGES = new Set(['en', 'hi', 'te']);
let FasterWhisperAdapter = FasterWhisperAdapter_1 = class FasterWhisperAdapter {
    engineId = process.env.VOICE_STT_ENGINE_ID ?? 'faster-whisper-small-int8';
    supportsPartial = false;
    logger = new common_1.Logger(FasterWhisperAdapter_1.name);
    endpoint = new URL('/transcribe', (0, voice_provider_util_1.readLoopbackUrl)('VOICE_STT_URL', 'http://127.0.0.1:8001'));
    slots = new voice_provider_util_1.Semaphore(2, 8);
    transcribe(request) {
        if (request.audio.data.length < 640 || request.audio.data.length > 640_000 ||
            request.audio.data.length % 2 !== 0) {
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
        const queuedAt = performance.now();
        return this.slots.run(async () => {
            const started = performance.now();
            const form = new FormData();
            form.append('file', new Blob([new Uint8Array(request.audio.data)], { type: 'application/octet-stream' }), 'audio.pcm');
            form.append('encoding', 'pcm_s16le');
            form.append('sample_rate', '16000');
            form.append('channels', '1');
            form.append('partial', String(request.partial));
            form.append('model', this.engineId);
            if (request.language !== 'auto')
                form.append('language', request.language);
            const vocabulary = (request.vocabulary ?? []).filter(name => name.length <= 120 &&
                /^[\p{L}\p{N} .&'()+-]+$/u.test(name)).slice(0, 40);
            let prompt = 'Product names: ';
            let promptedNames = 0;
            for (const name of vocabulary) {
                if (prompt.length + name.length + 3 > 200)
                    break;
                prompt += `${promptedNames ? ', ' : ''}${name}`;
                promptedNames++;
            }
            if (promptedNames)
                form.append('initial_prompt', `${prompt}.`);
            return (0, voice_provider_util_1.fetchWithTimeout)(this.endpoint, {
                method: 'POST',
                body: form,
                ...(request.requestId ? { headers: { 'x-mczen-request-id': request.requestId } } : {}),
                signal: request.signal,
            }, request.partial ? 12_000 : 45_000, async (response) => {
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
                const languageProbability = payload.languageProbability;
                if (languageProbability !== undefined && (typeof languageProbability !== 'number' ||
                    !Number.isFinite(languageProbability) || languageProbability < 0 || languageProbability > 1)) {
                    throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
                }
                const processingMs = payload.processingMs;
                if (processingMs !== undefined && (typeof processingMs !== 'number' || !Number.isFinite(processingMs) || processingMs < 0)) {
                    throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
                }
                const quality = payload.recognitionQuality;
                if (quality !== undefined && !isRecognitionQuality(quality)) {
                    throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
                }
                const timings = payload.timings;
                if (timings !== undefined && !isSttTimings(timings)) {
                    throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
                }
                this.logger.log({
                    event: 'voice_stt_request_timing', requestId: request.requestId, partial: request.partial,
                    engineId: this.engineId, queueMs: started - queuedAt, durationMs: performance.now() - started,
                    processingMs, timings, audioMs: request.audio.data.length / 32, status: response.status,
                });
                return {
                    text: payload.text,
                    language: payload.language,
                    ...(typeof languageProbability === 'number' ? { languageProbability } : {}),
                    confidence: confidence,
                    isFinal: !request.partial,
                    ...(typeof processingMs === 'number' ? { processingMs } : {}),
                    ...(quality === undefined ? {} : { recognitionQuality: quality }),
                    ...(timings === undefined ? {} : { timings }),
                };
            });
        }, request.signal);
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
exports.FasterWhisperAdapter = FasterWhisperAdapter = FasterWhisperAdapter_1 = __decorate([
    (0, common_1.Injectable)()
], FasterWhisperAdapter);
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isSttTimings(value) {
    return isRecord(value) && [
        'dispatchMs', 'preprocessingMs', 'queueMs', 'inferenceMs',
        'featureMs', 'encoderMs', 'decoderMs', 'postprocessingMs',
    ].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0);
}
function isRecognitionQuality(value) {
    if (!isRecord(value) || typeof value.reliable !== 'boolean' ||
        !['accepted', 'no_speech', 'low_log_probability', 'likely_no_speech'].includes(String(value.reason)))
        return false;
    if ((value.reason === 'accepted') !== value.reliable)
        return false;
    for (const key of ['audioRms', 'audioPeak', 'clippedFraction']) {
        const level = value[key];
        if (level !== undefined && (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1))
            return false;
    }
    return (value.avgLogProbability === undefined || (typeof value.avgLogProbability === 'number' &&
        Number.isFinite(value.avgLogProbability) && value.avgLogProbability <= 0)) &&
        (value.noSpeechProbability === undefined || (typeof value.noSpeechProbability === 'number' &&
            Number.isFinite(value.noSpeechProbability) && value.noSpeechProbability >= 0 && value.noSpeechProbability <= 1));
}
//# sourceMappingURL=faster-whisper.adapter.js.map