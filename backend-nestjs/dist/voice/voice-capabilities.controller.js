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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceCapabilitiesController = void 0;
const common_1 = require("@nestjs/common");
const auth_decorators_1 = require("../auth/auth.decorators");
const shared_state_1 = require("../shared-state/shared-state");
const stt_port_1 = require("./stt/stt.port");
const tts_port_1 = require("./tts/tts.port");
const vad_port_1 = require("./vad/vad.port");
const voice_session_manager_1 = require("./voice-session.manager");
const LANGUAGES = ['en', 'hi', 'te'];
let VoiceCapabilitiesController = class VoiceCapabilitiesController {
    stt;
    tts;
    vad;
    store;
    constructor(stt, tts, vad, store) {
        this.stt = stt;
        this.tts = tts;
        this.vad = vad;
        this.store = store;
    }
    async capabilities() {
        const [stt, tts, vad] = await Promise.all([this.stt, this.tts, this.vad].map(async (port) => {
            try {
                return await port.healthCheck();
            }
            catch {
                return false;
            }
        }));
        return {
            protocol: 'mczen-voice.v1',
            providers: {
                stt: { engine: this.stt.engineId, healthy: stt },
                tts: { engine: this.tts.engineId, healthy: tts },
                vad: { engine: this.vad.engineId, healthy: vad },
            },
            languages: LANGUAGES.map((language) => ({
                language,
                recognition: true,
                speech: this.tts.supports(language),
                textOnly: !this.tts.supports(language),
                voices: this.tts.voices(language),
            })),
            limits: {
                maxSessionsPerTenant: voice_session_manager_1.MAX_TENANT_SESSIONS,
                maxSessionsPerUser: 1,
                maxSessionsPerInstance: voice_session_manager_1.MAX_GLOBAL_SESSIONS,
                maxSessionSeconds: voice_session_manager_1.MAX_SESSION_MS / 1000,
            },
            scaling: 'Tickets, rate limits, session concurrency slots and resume metadata use the shared store (see storage.driver). Live audio pipelines and sockets are per-instance: use sticky routing for /api/voice/stream; a resume that lands on another instance is rejected and the client starts a new session on the same conversation.',
            storage: { driver: this.store.driver },
        };
    }
};
exports.VoiceCapabilitiesController = VoiceCapabilitiesController;
__decorate([
    (0, common_1.Get)('capabilities'),
    (0, auth_decorators_1.RequirePermission)('assistants:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], VoiceCapabilitiesController.prototype, "capabilities", null);
exports.VoiceCapabilitiesController = VoiceCapabilitiesController = __decorate([
    (0, common_1.Controller)('api/voice'),
    __param(0, (0, common_1.Inject)(stt_port_1.SPEECH_TO_TEXT)),
    __param(1, (0, common_1.Inject)(tts_port_1.TEXT_TO_SPEECH)),
    __param(2, (0, common_1.Inject)(vad_port_1.VOICE_ACTIVITY)),
    __param(3, (0, common_1.Inject)(shared_state_1.SHARED_STATE)),
    __metadata("design:paramtypes", [Object, Object, Object, Object])
], VoiceCapabilitiesController);
//# sourceMappingURL=voice-capabilities.controller.js.map