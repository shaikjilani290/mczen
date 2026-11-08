import { type SharedState } from '../shared-state/shared-state';
import { type SpeechToTextPort } from './stt/stt.port';
import { type TextToSpeechPort } from './tts/tts.port';
import { type VoiceActivityPort } from './vad/vad.port';
export declare class VoiceCapabilitiesController {
    private readonly stt;
    private readonly tts;
    private readonly vad;
    private readonly store;
    constructor(stt: SpeechToTextPort, tts: TextToSpeechPort, vad: VoiceActivityPort, store: SharedState);
    capabilities(): Promise<{
        protocol: string;
        providers: {
            stt: {
                configuredProvider?: "local" | "remote" | undefined;
                localFallbackEnabled?: boolean | undefined;
                timeoutMs?: number;
                engine: string;
                healthy: boolean;
            };
            tts: {
                engine: string;
                healthy: boolean;
            };
            vad: {
                engine: string;
                healthy: boolean;
            };
        };
        languages: {
            language: "en" | "hi" | "te";
            recognition: boolean;
            speech: boolean;
            textOnly: boolean;
            voices: readonly import("./tts/tts.port").TtsVoiceOption[];
        }[];
        limits: {
            maxSessionsPerTenant: number;
            maxSessionsPerUser: number;
            maxSessionsPerInstance: number;
            maxSessionSeconds: number;
        };
        scaling: string;
        storage: {
            driver: "memory" | "redis";
        };
    }>;
}
