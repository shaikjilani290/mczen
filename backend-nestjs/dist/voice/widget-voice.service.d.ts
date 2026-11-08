import { VoiceLibraryService } from './voice-library.service';
import { type SpeechToTextPort } from './stt/stt.port';
import { type TextToSpeechPort } from './tts/tts.port';
import { type VoiceActivityPort } from './vad/vad.port';
import { VoiceAuthService } from './voice-auth.service';
import { VoiceTicketService } from './voice-ticket.service';
import type { VoiceLanguage } from './voice.types';
export interface WidgetVoiceAvailability {
    voices?: Array<{
        id: string;
        label: string;
        language: VoiceLanguage;
    }>;
    available: boolean;
    speechLanguages: VoiceLanguage[];
    textOnlyLanguages: VoiceLanguage[];
    diagnostics: {
        unavailable: Array<'stt' | 'tts' | 'vad'>;
        reason?: 'engines_unavailable' | 'assistant_settings_unavailable' | 'no_speech_language';
    };
}
export declare class WidgetVoiceService {
    private readonly auth;
    private readonly tickets;
    private readonly stt;
    private readonly tts;
    private readonly vad;
    private readonly library?;
    private readonly logger;
    private health?;
    private probing?;
    constructor(auth: VoiceAuthService, tickets: VoiceTicketService, stt: SpeechToTextPort, tts: TextToSpeechPort, vad: VoiceActivityPort, library?: VoiceLibraryService | undefined);
    availability(tenantId: string, assistantId: string): Promise<WidgetVoiceAvailability>;
    issueTicket(input: {
        tenantId: string;
        assistantId: string;
        conversationId: string;
        widgetSessionId: string;
        origin: string;
        merchant?: {
            integrationId: string;
            sessionId: string;
            origin: string;
        };
    }): Promise<{
        ticket: string;
        expiresInMs: number;
        availability: WidgetVoiceAvailability;
    }>;
    private unavailableEngines;
}
