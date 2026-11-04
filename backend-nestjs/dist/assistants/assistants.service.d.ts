import type { EntityManager } from 'typeorm';
import { AssistantRepository } from './assistant.repository';
import { type CreateAssistantInput, type InstructionsInput, type SecretKind, type UpdateAssistantInput } from './assistants.dto';
import { SecretCipher } from './secret-cipher.service';
export declare class AssistantsService {
    private readonly repo;
    private readonly cipher;
    constructor(repo: AssistantRepository, cipher: SecretCipher);
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
    get(id: string, manager?: EntityManager): Promise<{
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
    create(input: CreateAssistantInput, actorId?: string): Promise<{
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
    update(id: string, input: UpdateAssistantInput, actorId?: string): Promise<{
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
    setInstructions(id: string, input: InstructionsInput, actorId?: string): Promise<{
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
    instructionHistory(id: string): Promise<{
        versions: {
            version: number;
            isActive: boolean;
            systemPrompt: unknown;
            guardrailNotes: string | null;
            createdBy: string | null;
            createdAt: string | null;
        }[];
    }>;
    setSecret(id: string, kind: SecretKind, apiKey: string, actorId?: string): Promise<{
        kind: "stt" | "tts";
        configured: boolean;
    }>;
    clearSecret(id: string, kind: SecretKind, actorId?: string): Promise<{
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
