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
var WidgetVoiceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WidgetVoiceService = void 0;
const common_1 = require("@nestjs/common");
const voice_library_service_1 = require("./voice-library.service");
const stt_port_1 = require("./stt/stt.port");
const tts_port_1 = require("./tts/tts.port");
const vad_port_1 = require("./vad/vad.port");
const voice_auth_service_1 = require("./voice-auth.service");
const voice_ticket_service_1 = require("./voice-ticket.service");
const HEALTH_CACHE_MS = 15_000;
const WIDGET_VOICE_PERMISSIONS = Object.freeze(['knowledge:read', 'products:read', 'inventory:read']);
let WidgetVoiceService = WidgetVoiceService_1 = class WidgetVoiceService {
    auth;
    tickets;
    stt;
    tts;
    vad;
    library;
    logger = new common_1.Logger(WidgetVoiceService_1.name);
    health;
    probing;
    constructor(auth, tickets, stt, tts, vad, library) {
        this.auth = auth;
        this.tickets = tickets;
        this.stt = stt;
        this.tts = tts;
        this.vad = vad;
        this.library = library;
    }
    async availability(tenantId, assistantId) {
        const unavailable = await this.unavailableEngines();
        if (unavailable.length)
            return {
                available: false, speechLanguages: [], textOnlyLanguages: [],
                diagnostics: { unavailable, reason: 'engines_unavailable' },
            };
        try {
            const { allowedLanguages, ttsLanguages } = await this.auth.resolveSettings(tenantId, assistantId, 'auto');
            const speechLanguages = ttsLanguages.filter((language) => this.tts.supports(language));
            if (speechLanguages.length === 0)
                return {
                    available: false, speechLanguages: [], textOnlyLanguages: allowedLanguages,
                    diagnostics: { unavailable: [], reason: 'no_speech_language' },
                };
            return {
                available: true,
                speechLanguages,
                voices: [
                    ...speechLanguages.flatMap((language) => this.tts.voices(language)),
                    ...(this.library ? await this.library.activeForTenant(tenantId) : []),
                ].filter((voice) => speechLanguages.includes(voice.language)),
                textOnlyLanguages: allowedLanguages.filter((language) => !speechLanguages.includes(language)),
                diagnostics: { unavailable: [] },
            };
        }
        catch (error) {
            this.logger.warn({
                event: 'widget_voice_settings_unavailable', tenantId, assistantId,
                reason: error instanceof common_1.ForbiddenException ? error.message : 'Settings lookup failed.',
            });
            return {
                available: false, speechLanguages: [], textOnlyLanguages: [],
                diagnostics: { unavailable: [], reason: 'assistant_settings_unavailable' },
            };
        }
    }
    async issueTicket(input) {
        this.logger.log({ event: 'widget_voice_capability_check', stage: 'checking_health_and_settings' });
        const availability = await this.availability(input.tenantId, input.assistantId);
        this.logger.log({ event: 'widget_voice_capability_check', stage: 'checked', available: availability.available,
            unavailable: availability.diagnostics.unavailable });
        if (!availability.available)
            throw new common_1.ServiceUnavailableException('Voice is currently unavailable.');
        if (!input.widgetSessionId)
            throw new common_1.ForbiddenException('Voice access is unavailable.');
        const issued = await this.tickets.issueIdentity({
            userId: '',
            sessionId: input.widgetSessionId,
            tenantId: input.tenantId,
            permissions: WIDGET_VOICE_PERMISSIONS,
            widget: {
                assistantId: input.assistantId,
                conversationId: input.conversationId,
                widgetSessionId: input.widgetSessionId,
                ...(input.merchant ? { merchant: input.merchant } : {}),
            },
        }, input.origin);
        return { ...issued, availability };
    }
    async unavailableEngines() {
        const now = Date.now();
        if (this.health && now - this.health.at < HEALTH_CACHE_MS)
            return this.health.unavailable;
        const engines = ['stt', 'tts', 'vad'];
        this.probing ??= Promise.all([this.stt, this.tts, this.vad].map(async (port) => {
            try {
                return await port.healthCheck();
            }
            catch {
                return false;
            }
        })).then((results) => {
            const unavailable = engines.filter((_, index) => !results[index]);
            this.health = { at: Date.now(), unavailable };
            if (unavailable.length)
                this.logger.warn({ event: 'widget_voice_engines_unavailable', engines: unavailable });
            return unavailable;
        }).finally(() => { this.probing = undefined; });
        return this.probing;
    }
};
exports.WidgetVoiceService = WidgetVoiceService;
exports.WidgetVoiceService = WidgetVoiceService = WidgetVoiceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(stt_port_1.SPEECH_TO_TEXT)),
    __param(3, (0, common_1.Inject)(tts_port_1.TEXT_TO_SPEECH)),
    __param(4, (0, common_1.Inject)(vad_port_1.VOICE_ACTIVITY)),
    __param(5, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [voice_auth_service_1.VoiceAuthService,
        voice_ticket_service_1.VoiceTicketService, Object, Object, Object, voice_library_service_1.VoiceLibraryService])
], WidgetVoiceService);
//# sourceMappingURL=widget-voice.service.js.map