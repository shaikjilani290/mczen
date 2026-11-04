import type { SpeechToTextPort, SttRequest, SttResult } from './stt.port';
export declare class FasterWhisperAdapter implements SpeechToTextPort {
    readonly engineId: string;
    private readonly endpoint;
    private readonly slots;
    transcribe(request: SttRequest): Promise<SttResult>;
    healthCheck(): Promise<boolean>;
}
