import { DataSource } from 'typeorm';
import { AuthStore } from '../auth/auth-store.service';
import { TokenService } from '../auth/token.service';
import type { VoiceLanguage, VoiceSettings } from './voice.types';
export interface VoiceWidgetBinding {
    assistantId: string;
    conversationId: string;
    widgetSessionId: string;
    merchant?: {
        integrationId: string;
        sessionId: string;
        origin: string;
    };
}
export interface VoiceIdentity {
    userId: string;
    sessionId: string;
    tenantId: string;
    permissions: readonly string[];
    widget?: VoiceWidgetBinding;
}
export declare class VoiceAuthService {
    private readonly tokens;
    private readonly authStore;
    private readonly database?;
    constructor(tokens: TokenService, authStore: AuthStore, database?: DataSource | undefined);
    authenticate(bearer: string): Promise<VoiceIdentity>;
    resolveSettings(tenantId: string, assistantId: string, requestedLanguage: 'auto' | VoiceLanguage): Promise<{
        settings: VoiceSettings;
        allowedLanguages: VoiceLanguage[];
        ttsLanguages: VoiceLanguage[];
        defaultLanguage: VoiceLanguage;
    }>;
    resolveLanguageVoice(tenantId: string, assistantId: string, language: VoiceLanguage): Promise<{
        enabled: boolean;
        voice: string | null;
        rate: number | null;
    }>;
    private getDatabase;
}
