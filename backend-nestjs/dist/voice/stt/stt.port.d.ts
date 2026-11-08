import type { RequestedVoiceLanguage, VoiceLanguage } from '../voice.types';
export interface SttRequest {
    audio: {
        encoding: 'pcm_s16le';
        sampleRate: 16000;
        channels: 1;
        data: Buffer;
    };
    language: RequestedVoiceLanguage;
    partial: boolean;
    signal: AbortSignal;
    requestId?: string;
    vocabulary?: readonly string[];
}
export interface SttResult {
    text: string;
    language: VoiceLanguage;
    languageProbability?: number;
    confidence?: number;
    isFinal: boolean;
    processingMs?: number;
    timings?: SttTimings;
    recognitionQuality?: {
        reliable: boolean;
        reason: 'accepted' | 'no_speech' | 'low_log_probability' | 'likely_no_speech';
        avgLogProbability?: number;
        noSpeechProbability?: number;
        audioRms?: number;
        audioPeak?: number;
        clippedFraction?: number;
    };
}
export interface SttTimings {
    dispatchMs: number;
    preprocessingMs: number;
    queueMs: number;
    inferenceMs: number;
    featureMs: number;
    encoderMs: number;
    decoderMs: number;
    postprocessingMs: number;
}
export interface SpeechToTextPort {
    readonly engineId: string;
    readonly supportsPartial?: boolean;
    transcribe(request: SttRequest): Promise<SttResult>;
    healthCheck(): Promise<boolean>;
    status?(): {
        configuredProvider: 'local' | 'remote';
        localFallbackEnabled: boolean;
        timeoutMs?: number;
    };
}
export declare const SPEECH_TO_TEXT: unique symbol;
