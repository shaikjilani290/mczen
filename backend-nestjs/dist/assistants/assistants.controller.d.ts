import type { AuthenticatedUser } from '../auth/auth-context';
import { AssistantsService } from './assistants.service';
export declare class AssistantsController {
    private readonly assistants;
    constructor(assistants: AssistantsService);
    options(): {
        languages: readonly ["en", "hi", "te"];
        sttProviders: readonly ["browser", "faster-whisper", "whisper-api", "google"];
        ttsProviders: readonly ["browser", "piper", "elevenlabs", "google"];
        voiceGenders: readonly ["female", "male", "neutral"];
        responseStyles: readonly ["concise", "balanced", "detailed"];
    };
    list(): Promise<{
        assistants: {
            id: string;
            name: unknown;
            description: string | null;
            status: unknown;
            isDefault: boolean;
            configVersion: number;
            updatedAt: string | null;
        }[];
    }>;
    create(user: AuthenticatedUser, body: unknown): Promise<{
        id: string;
        isDefault: boolean;
        configVersion: number;
        createdAt: string | null;
        updatedAt: string | null;
        profile: {
            name: unknown;
            description: string | null;
            personality: string | null;
            greetingMessage: string | null;
            fallbackMessage: string | null;
            status: unknown;
        };
        language: {
            mode: unknown;
            defaultLanguage: {};
            enabled: ("en" | "hi" | "te")[];
        };
        voice: {
            speechEnabled: boolean;
            autoSpeak: boolean;
            sttProvider: unknown;
            ttsProvider: unknown;
            voiceGender: unknown;
            voiceId: string | null;
            speechRate: number;
            speechPitch: number;
        } | undefined;
        secrets: {
            stt: {
                configured: boolean;
            };
            tts: {
                configured: boolean;
            };
        };
        branding: {
            displayName: string | null;
            primaryColor: string | null;
            logoUrl: string | null;
        };
        preferences: {
            responseStyle: unknown;
            showSources: boolean;
        };
        instructions: {
            version: number;
            systemPrompt: unknown;
            guardrailNotes: string | null;
        } | undefined;
    }>;
    get(id: string): Promise<{
        id: string;
        isDefault: boolean;
        configVersion: number;
        createdAt: string | null;
        updatedAt: string | null;
        profile: {
            name: unknown;
            description: string | null;
            personality: string | null;
            greetingMessage: string | null;
            fallbackMessage: string | null;
            status: unknown;
        };
        language: {
            mode: unknown;
            defaultLanguage: {};
            enabled: ("en" | "hi" | "te")[];
        };
        voice: {
            speechEnabled: boolean;
            autoSpeak: boolean;
            sttProvider: unknown;
            ttsProvider: unknown;
            voiceGender: unknown;
            voiceId: string | null;
            speechRate: number;
            speechPitch: number;
        } | undefined;
        secrets: {
            stt: {
                configured: boolean;
            };
            tts: {
                configured: boolean;
            };
        };
        branding: {
            displayName: string | null;
            primaryColor: string | null;
            logoUrl: string | null;
        };
        preferences: {
            responseStyle: unknown;
            showSources: boolean;
        };
        instructions: {
            version: number;
            systemPrompt: unknown;
            guardrailNotes: string | null;
        } | undefined;
    }>;
    update(user: AuthenticatedUser, id: string, body: unknown): Promise<{
        id: string;
        isDefault: boolean;
        configVersion: number;
        createdAt: string | null;
        updatedAt: string | null;
        profile: {
            name: unknown;
            description: string | null;
            personality: string | null;
            greetingMessage: string | null;
            fallbackMessage: string | null;
            status: unknown;
        };
        language: {
            mode: unknown;
            defaultLanguage: {};
            enabled: ("en" | "hi" | "te")[];
        };
        voice: {
            speechEnabled: boolean;
            autoSpeak: boolean;
            sttProvider: unknown;
            ttsProvider: unknown;
            voiceGender: unknown;
            voiceId: string | null;
            speechRate: number;
            speechPitch: number;
        } | undefined;
        secrets: {
            stt: {
                configured: boolean;
            };
            tts: {
                configured: boolean;
            };
        };
        branding: {
            displayName: string | null;
            primaryColor: string | null;
            logoUrl: string | null;
        };
        preferences: {
            responseStyle: unknown;
            showSources: boolean;
        };
        instructions: {
            version: number;
            systemPrompt: unknown;
            guardrailNotes: string | null;
        } | undefined;
    }>;
    instructions(id: string): Promise<{
        versions: {
            version: number;
            isActive: boolean;
            systemPrompt: unknown;
            guardrailNotes: string | null;
            createdBy: string | null;
            createdAt: string | null;
        }[];
    }>;
    setInstructions(user: AuthenticatedUser, id: string, body: unknown): Promise<{
        id: string;
        isDefault: boolean;
        configVersion: number;
        createdAt: string | null;
        updatedAt: string | null;
        profile: {
            name: unknown;
            description: string | null;
            personality: string | null;
            greetingMessage: string | null;
            fallbackMessage: string | null;
            status: unknown;
        };
        language: {
            mode: unknown;
            defaultLanguage: {};
            enabled: ("en" | "hi" | "te")[];
        };
        voice: {
            speechEnabled: boolean;
            autoSpeak: boolean;
            sttProvider: unknown;
            ttsProvider: unknown;
            voiceGender: unknown;
            voiceId: string | null;
            speechRate: number;
            speechPitch: number;
        } | undefined;
        secrets: {
            stt: {
                configured: boolean;
            };
            tts: {
                configured: boolean;
            };
        };
        branding: {
            displayName: string | null;
            primaryColor: string | null;
            logoUrl: string | null;
        };
        preferences: {
            responseStyle: unknown;
            showSources: boolean;
        };
        instructions: {
            version: number;
            systemPrompt: unknown;
            guardrailNotes: string | null;
        } | undefined;
    }>;
    setSecret(user: AuthenticatedUser, id: string, kind: string, body: unknown): Promise<{
        kind: "stt" | "tts";
        configured: boolean;
    }>;
    clearSecret(user: AuthenticatedUser, id: string, kind: string): Promise<{
        kind: "stt" | "tts";
        configured: boolean;
    }>;
    audit(id: string): Promise<{
        entries: {
            id: number;
            action: unknown;
            configVersion: number;
            changedFields: string[];
            actorUserId: string | null;
            createdAt: string | null;
        }[];
    }>;
}
