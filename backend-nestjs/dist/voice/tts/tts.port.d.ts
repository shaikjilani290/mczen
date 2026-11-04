import type { VoiceLanguage } from '../voice.types';
export interface TtsRequest {
    text: string;
    language: VoiceLanguage;
    voice: string;
    rate: number;
    signal: AbortSignal;
}
export interface TtsAudioChunk {
    encoding: 'pcm_s16le';
    sampleRate: 16000;
    data: Buffer;
}
export interface TtsVoiceOption {
    id: string;
    label: string;
    gender: 'male' | 'female';
    language: VoiceLanguage;
}
export interface TextToSpeechPort {
    readonly engineId: string;
    supports(language: VoiceLanguage): boolean;
    supportsVoice(language: VoiceLanguage, voice: string): boolean;
    voices(language: VoiceLanguage): readonly TtsVoiceOption[];
    synthesize(request: TtsRequest): AsyncIterable<TtsAudioChunk>;
    healthCheck(): Promise<boolean>;
}
export declare const TEXT_TO_SPEECH: unique symbol;
