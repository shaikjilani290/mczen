"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CompositeTtsAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompositeTtsAdapter = void 0;
const common_1 = require("@nestjs/common");
const dhvaani_adapter_1 = require("./dhvaani.adapter");
const piper_adapter_1 = require("./piper.adapter");
const voice_provider_util_1 = require("../voice-provider.util");
let CompositeTtsAdapter = CompositeTtsAdapter_1 = class CompositeTtsAdapter {
    dhvaani;
    piper;
    engineId = 'composite';
    logger = new common_1.Logger(CompositeTtsAdapter_1.name);
    constructor(dhvaani, piper) {
        this.dhvaani = dhvaani;
        this.piper = piper;
    }
    supports(language) {
        return this.dhvaani.supports(language) || this.piper.supports(language);
    }
    supportsVoice(language, voice) {
        return (this.dhvaani.supportsVoice(language, voice) ||
            this.piper.supportsVoice(language, voice));
    }
    voices(language) {
        const combined = [
            ...this.dhvaani.voices(language),
            ...this.piper.voices(language),
        ];
        return combined.filter((voice, index, all) => all.findIndex((item) => item.id === voice.id) === index);
    }
    async *synthesize(request) {
        const primary = this.dhvaani.supportsVoice(request.language, request.voice)
            ? this.dhvaani
            : this.piper.supportsVoice(request.language, request.voice)
                ? this.piper
                : undefined;
        if (!primary)
            throw new voice_provider_util_1.VoiceProviderError('VOICE_PROVIDER_INVALID');
        let emittedAudio = false;
        try {
            for await (const chunk of primary.synthesize(request)) {
                emittedAudio = true;
                yield chunk;
            }
            return;
        }
        catch (error) {
            if (emittedAudio || request.signal.aborted)
                throw error;
            const fallback = primary === this.dhvaani ? this.piper : this.dhvaani;
            const fallbackVoice = fallback.voices(request.language)[0]?.id;
            if (!fallbackVoice)
                throw error;
            const failureCode = this.failureCode(error);
            this.logger.warn(JSON.stringify({
                event: 'voice_tts_provider_fallback',
                primaryEngine: primary.engineId,
                fallbackEngine: fallback.engineId,
                primaryFailureCode: failureCode,
                language: request.language,
                textChars: request.text.length,
            }));
            try {
                yield* fallback.synthesize({ ...request, voice: fallbackVoice });
            }
            catch (fallbackError) {
                this.logger.error(JSON.stringify({
                    event: 'voice_tts_fallback_failed',
                    primaryEngine: primary.engineId,
                    fallbackEngine: fallback.engineId,
                    primaryFailureCode: failureCode,
                    fallbackFailureCode: this.failureCode(fallbackError),
                    language: request.language,
                    textChars: request.text.length,
                }));
                throw fallbackError;
            }
        }
    }
    async healthCheck() {
        const results = await Promise.allSettled([
            this.dhvaani.healthCheck(),
            this.piper.healthCheck(),
        ]);
        return results.some((result) => result.status === 'fulfilled' && result.value);
    }
    failureCode(error) {
        return error instanceof voice_provider_util_1.VoiceProviderError ? error.code : 'VOICE_ENGINE_UNAVAILABLE';
    }
};
exports.CompositeTtsAdapter = CompositeTtsAdapter;
exports.CompositeTtsAdapter = CompositeTtsAdapter = CompositeTtsAdapter_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [dhvaani_adapter_1.DhvaaniAdapter,
        piper_adapter_1.PiperAdapter])
], CompositeTtsAdapter);
//# sourceMappingURL=composite-tts.adapter.js.map