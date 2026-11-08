import type { VadRequest, VadResult, VoiceActivityPort } from './vad.port';
export declare class SileroVadAdapter implements VoiceActivityPort {
    readonly engineId = "silero-vad";
    private readonly logger;
    private readonly slots;
    private lastLoggedAt;
    private readonly endpoint;
    detect(request: VadRequest): Promise<VadResult>;
    detectBatch(request: VadRequest): Promise<VadResult[]>;
    healthCheck(): Promise<boolean>;
}
