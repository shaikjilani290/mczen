"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceModule = void 0;
const common_1 = require("@nestjs/common");
const agent_module_1 = require("../agent/agent.module");
const auth_module_1 = require("../auth/auth.module");
const conversations_module_1 = require("../conversations/conversations.module");
const agent_invocation_adapter_1 = require("./agent-invocation.adapter");
const agent_invocation_port_1 = require("./agent-invocation.port");
const faster_whisper_adapter_1 = require("./stt/faster-whisper.adapter");
const configured_stt_adapter_1 = require("./stt/configured-stt.adapter");
const stt_port_1 = require("./stt/stt.port");
const silero_vad_adapter_1 = require("./vad/silero-vad.adapter");
const vad_port_1 = require("./vad/vad.port");
const piper_adapter_1 = require("./tts/piper.adapter");
const dhvaani_adapter_1 = require("./tts/dhvaani.adapter");
const composite_tts_adapter_1 = require("./tts/composite-tts.adapter");
const tts_port_1 = require("./tts/tts.port");
const voice_auth_service_1 = require("./voice-auth.service");
const voice_gateway_1 = require("./voice.gateway");
const voice_session_manager_1 = require("./voice-session.manager");
const voice_session_repository_1 = require("./voice-session.repository");
const voice_ticket_controller_1 = require("./voice-ticket.controller");
const voice_capabilities_controller_1 = require("./voice-capabilities.controller");
const voice_ticket_service_1 = require("./voice-ticket.service");
const widget_voice_service_1 = require("./widget-voice.service");
const voice_library_service_1 = require("./voice-library.service");
const voice_library_controller_1 = require("./voice-library.controller");
const website_data_module_1 = require("../website-integrations/website-data.module");
let VoiceModule = class VoiceModule {
};
exports.VoiceModule = VoiceModule;
exports.VoiceModule = VoiceModule = __decorate([
    (0, common_1.Module)({
        imports: [agent_module_1.AgentModule, auth_module_1.AuthModule, conversations_module_1.ConversationsModule, website_data_module_1.WebsiteDataModule],
        controllers: [voice_ticket_controller_1.VoiceTicketController, voice_capabilities_controller_1.VoiceCapabilitiesController, voice_library_controller_1.VoiceLibraryController],
        exports: [widget_voice_service_1.WidgetVoiceService],
        providers: [
            voice_library_service_1.VoiceLibraryService,
            widget_voice_service_1.WidgetVoiceService,
            voice_auth_service_1.VoiceAuthService,
            voice_session_repository_1.VoiceSessionRepository,
            voice_ticket_service_1.VoiceTicketService,
            voice_session_manager_1.VoiceSessionManager,
            voice_gateway_1.VoiceGateway,
            faster_whisper_adapter_1.FasterWhisperAdapter,
            configured_stt_adapter_1.ConfiguredSttAdapter,
            silero_vad_adapter_1.SileroVadAdapter,
            piper_adapter_1.PiperAdapter,
            dhvaani_adapter_1.DhvaaniAdapter,
            composite_tts_adapter_1.CompositeTtsAdapter,
            agent_invocation_adapter_1.AgentInvocationAdapter,
            { provide: stt_port_1.SPEECH_TO_TEXT, useExisting: configured_stt_adapter_1.ConfiguredSttAdapter },
            { provide: vad_port_1.VOICE_ACTIVITY, useExisting: silero_vad_adapter_1.SileroVadAdapter },
            { provide: tts_port_1.TEXT_TO_SPEECH, useExisting: composite_tts_adapter_1.CompositeTtsAdapter },
            { provide: agent_invocation_port_1.AGENT_INVOCATION, useExisting: agent_invocation_adapter_1.AgentInvocationAdapter },
        ],
    })
], VoiceModule);
//# sourceMappingURL=voice.module.js.map