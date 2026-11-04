import type { VadRequest, VadResult, VoiceActivityPort } from './vad.port';
export declare class SileroVadAdapter implements VoiceActivityPort {
    readonly engineId = "silero-vad";
    private readonly endpoint;
    detect(request: VadRequest): Promise<VadResult>;
    healthCheck(): Promise<boolean>;
}
