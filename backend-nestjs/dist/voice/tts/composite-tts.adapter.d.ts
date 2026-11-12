import { DhvaaniAdapter } from './dhvaani.adapter';
import { PiperAdapter } from './piper.adapter';
import type { TextToSpeechPort, TtsAudioChunk, TtsRequest, TtsVoiceOption } from './tts.port';
import type { VoiceLanguage } from '../voice.types';
export declare class CompositeTtsAdapter implements TextToSpeechPort {
    private readonly dhvaani;
    private readonly piper;
    readonly engineId = "composite";
    private readonly logger;
    constructor(dhvaani: DhvaaniAdapter, piper: PiperAdapter);
    supports(language: VoiceLanguage): boolean;
    supportsVoice(language: VoiceLanguage, voice: string): boolean;
    voices(language: VoiceLanguage): readonly TtsVoiceOption[];
    synthesize(request: TtsRequest): AsyncIterable<TtsAudioChunk>;
    healthCheck(): Promise<boolean>;
    private failureCode;
}
