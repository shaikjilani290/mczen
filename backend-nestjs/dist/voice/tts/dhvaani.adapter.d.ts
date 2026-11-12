import type { VoiceLanguage } from '../voice.types';
import type { TextToSpeechPort, TtsAudioChunk, TtsRequest, TtsVoiceOption } from './tts.port';
export declare class DhvaaniAdapter implements TextToSpeechPort {
    readonly engineId = "dhvaani";
    private readonly baseUrl;
    private readonly slots;
    supports(language: VoiceLanguage): boolean;
    supportsVoice(language: VoiceLanguage, voice: string): boolean;
    voices(language: VoiceLanguage): readonly TtsVoiceOption[];
    synthesize(request: TtsRequest): AsyncIterable<TtsAudioChunk>;
    private convertWavToPcm16k;
    healthCheck(): Promise<boolean>;
}
