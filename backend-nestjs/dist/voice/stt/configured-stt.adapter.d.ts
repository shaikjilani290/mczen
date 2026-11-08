import { FasterWhisperAdapter } from './faster-whisper.adapter';
import type { SpeechToTextPort, SttRequest, SttResult } from './stt.port';
export declare class ConfiguredSttAdapter implements SpeechToTextPort {
    private readonly local;
    readonly supportsPartial = false;
    readonly engineId: string;
    private readonly logger;
    private readonly slots;
    private readonly provider;
    private readonly fallbackEnabled;
    private readonly endpoint?;
    private readonly apiKey?;
    private readonly timeoutMs;
    private promptSupport?;
    constructor(local: FasterWhisperAdapter);
    status(): {
        timeoutMs?: number | undefined;
        configuredProvider: "local" | "remote";
        localFallbackEnabled: boolean;
    };
    transcribe(request: SttRequest): Promise<SttResult>;
    private remoteTranscribe;
    private supportsInitialPrompt;
    healthCheck(): Promise<boolean>;
}
