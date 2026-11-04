import type { VoiceLanguage } from '../voice.types';
import type { TextToSpeechPort, TtsAudioChunk, TtsRequest, TtsVoiceOption } from './tts.port';
export declare class PiperAdapter implements TextToSpeechPort {
    readonly engineId = "piper";
    private readonly endpoint;
    private readonly slots;
    supports(language: VoiceLanguage): boolean;
    supportsVoice(language: VoiceLanguage, voice: string): boolean;
    voices(language: VoiceLanguage): readonly TtsVoiceOption[];
    synthesize(request: TtsRequest): AsyncIterable<TtsAudioChunk>;
    healthCheck(): Promise<boolean>;
}
