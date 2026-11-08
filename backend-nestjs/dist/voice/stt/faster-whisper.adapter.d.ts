import type { SpeechToTextPort, SttRequest, SttResult } from './stt.port';
export declare class FasterWhisperAdapter implements SpeechToTextPort {
    readonly engineId: string;
    readonly supportsPartial = false;
    private readonly logger;
    private readonly endpoint;
    private readonly slots;
    transcribe(request: SttRequest): Promise<SttResult>;
    healthCheck(): Promise<boolean>;
}
export declare function isRecognitionQuality(value: unknown): value is NonNullable<SttResult['recognitionQuality']>;
