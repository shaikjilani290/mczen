export interface VadRequest {
    streamId?: string;
    audio: {
        encoding: 'pcm_s16le';
        sampleRate: 16000;
        channels: 1;
        data: Buffer;
    };
    signal: AbortSignal;
}
export interface VadResult {
    speech: boolean;
    probability: number;
}
export interface VoiceActivityPort {
    readonly engineId: string;
    detect(request: VadRequest): Promise<VadResult>;
    detectBatch?(request: VadRequest): Promise<VadResult[]>;
    healthCheck(): Promise<boolean>;
}
export declare const VOICE_ACTIVITY: unique symbol;
