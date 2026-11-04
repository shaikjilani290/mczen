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
exports.WidgetVoiceService = void 0;
const common_1 = require("@nestjs/common");
const stt_port_1 = require("./stt/stt.port");
const tts_port_1 = require("./tts/tts.port");
const vad_port_1 = require("./vad/vad.port");
const voice_auth_service_1 = require("./voice-auth.service");
const voice_ticket_service_1 = require("./voice-ticket.service");
const HEALTH_CACHE_MS = 15_000;
const WIDGET_VOICE_PERMISSIONS = Object.freeze(['knowledge:read', 'products:read', 'inventory:read']);
const UNAVAILABLE = { available: false, speechLanguages: [], textOnlyLanguages: [] };
let WidgetVoiceService = class WidgetVoiceService {
    auth;
    tickets;
    stt;
    tts;
    vad;
    health;
    probing;
    constructor(auth, tickets, stt, tts, vad) {
        this.auth = auth;
        this.tickets = tickets;
        this.stt = stt;
        this.tts = tts;
        this.vad = vad;
    }
    async availability(tenantId, assistantId) {
        if (!(await this.enginesHealthy()))
            return UNAVAILABLE;
        try {
            const { allowedLanguages, ttsLanguages } = await this.auth.resolveSettings(tenantId, assistantId, 'auto');
            const speechLanguages = ttsLanguages.filter((language) => this.tts.supports(language));
            if (speechLanguages.length === 0)
                return UNAVAILABLE;
            return {
                available: true,
                speechLanguages,
                textOnlyLanguages: allowedLanguages.filter((language) => !speechLanguages.includes(language)),
            };
        }
        catch {
            return UNAVAILABLE;
        }
    }
    async issueTicket(input) {
        const availability = await this.availability(input.tenantId, input.assistantId);
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
            },
        }, input.origin);
        return { ...issued, availability };
    }
    async enginesHealthy() {
        const now = Date.now();
        if (this.health && now - this.health.at < HEALTH_CACHE_MS)
            return this.health.ok;
        this.probing ??= Promise.all([this.stt, this.tts, this.vad].map(async (port) => {
            try {
                return await port.healthCheck();
            }
            catch {
                return false;
            }
        })).then((results) => results.every(Boolean)).then((ok) => {
            this.health = { at: Date.now(), ok };
            return ok;
        }).finally(() => { this.probing = undefined; });
        return this.probing;
    }
};
exports.WidgetVoiceService = WidgetVoiceService;
exports.WidgetVoiceService = WidgetVoiceService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(stt_port_1.SPEECH_TO_TEXT)),
    __param(3, (0, common_1.Inject)(tts_port_1.TEXT_TO_SPEECH)),
    __param(4, (0, common_1.Inject)(vad_port_1.VOICE_ACTIVITY)),
    __metadata("design:paramtypes", [voice_auth_service_1.VoiceAuthService,
        voice_ticket_service_1.VoiceTicketService, Object, Object, Object])
], WidgetVoiceService);
//# sourceMappingURL=widget-voice.service.js.map