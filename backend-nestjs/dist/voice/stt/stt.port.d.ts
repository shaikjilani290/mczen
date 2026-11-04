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
}
export interface SttResult {
    text: string;
    language: VoiceLanguage;
    confidence?: number;
    isFinal: boolean;
}
export interface SpeechToTextPort {
    readonly engineId: string;
    transcribe(request: SttRequest): Promise<SttResult>;
    healthCheck(): Promise<boolean>;
}
export declare const SPEECH_TO_TEXT: unique symbol;
