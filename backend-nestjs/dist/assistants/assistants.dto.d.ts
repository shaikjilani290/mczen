export declare const LANGUAGES: readonly ["en", "hi", "te"];
export type Language = (typeof LANGUAGES)[number];
export declare const STT_PROVIDERS: readonly ["browser", "faster-whisper", "whisper-api", "google"];
export declare const TTS_PROVIDERS: readonly ["browser", "piper", "elevenlabs", "google"];
export declare const VOICE_GENDERS: readonly ["female", "male", "neutral"];
export declare const RESPONSE_STYLES: readonly ["concise", "balanced", "detailed"];
export declare const STATUSES: readonly ["draft", "active", "paused", "archived"];
export declare const SECRET_KINDS: readonly ["stt", "tts"];
export type SecretKind = (typeof SECRET_KINDS)[number];
export declare const MAX_SYSTEM_PROMPT = 16000;
export interface CreateAssistantInput {
    name: string;
    description?: string | null;
    systemPrompt?: string;
}
export declare function parseCreateAssistant(body: unknown): CreateAssistantInput;
export interface UpdateAssistantInput {
    profile?: {
        name?: string;
        description?: string | null;
        personality?: string | null;
        greetingMessage?: string | null;
        fallbackMessage?: string | null;
        status?: (typeof STATUSES)[number];
    };
    language?: {
        mode?: 'auto' | 'manual';
        defaultLanguage?: Language;
        enabled?: Language[];
    };
    voice?: {
        speechEnabled?: boolean;
        autoSpeak?: boolean;
        sttProvider?: (typeof STT_PROVIDERS)[number];
        ttsProvider?: (typeof TTS_PROVIDERS)[number];
        voiceGender?: (typeof VOICE_GENDERS)[number];
        voiceId?: string | null;
        speechRate?: number;
        speechPitch?: number;
    };
    branding?: {
        displayName?: string | null;
        primaryColor?: string | null;
        logoUrl?: string | null;
    };
    preferences?: {
        responseStyle?: (typeof RESPONSE_STYLES)[number];
        showSources?: boolean;
    };
}
export declare function parseUpdateAssistant(body: unknown): UpdateAssistantInput;
export interface InstructionsInput {
    systemPrompt: string;
    guardrailNotes?: string | null;
}
export declare function parseInstructions(body: unknown): InstructionsInput;
export declare function parseSecretKind(value: unknown): SecretKind;
export declare function parseSecretInput(body: unknown): string;
