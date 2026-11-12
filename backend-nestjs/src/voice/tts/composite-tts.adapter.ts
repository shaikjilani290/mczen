import { Injectable, Logger } from '@nestjs/common';
import { DhvaaniAdapter } from './dhvaani.adapter';
import { PiperAdapter } from './piper.adapter';
import type { TextToSpeechPort, TtsAudioChunk, TtsRequest, TtsVoiceOption } from './tts.port';
import type { VoiceLanguage } from '../voice.types';
import { VoiceProviderError } from '../voice-provider.util';

@Injectable()
export class CompositeTtsAdapter implements TextToSpeechPort {
  readonly engineId = 'composite';
  private readonly logger = new Logger(CompositeTtsAdapter.name);

  constructor(
    private readonly dhvaani: DhvaaniAdapter,
    private readonly piper: PiperAdapter,
  ) {}

  supports(language: VoiceLanguage): boolean {
    return this.dhvaani.supports(language) || this.piper.supports(language);
  }

  supportsVoice(language: VoiceLanguage, voice: string): boolean {
    return (
      this.dhvaani.supportsVoice(language, voice) ||
      this.piper.supportsVoice(language, voice)
    );
  }

  voices(language: VoiceLanguage): readonly TtsVoiceOption[] {
    const combined = [
      ...this.dhvaani.voices(language),
      ...this.piper.voices(language),
    ];

    return combined.filter(
      (voice, index, all) =>
        all.findIndex((item) => item.id === voice.id) === index,
    );
  }

  async *synthesize(request: TtsRequest): AsyncIterable<TtsAudioChunk> {
    const primary = this.dhvaani.supportsVoice(request.language, request.voice)
      ? this.dhvaani
      : this.piper.supportsVoice(request.language, request.voice)
        ? this.piper
        : undefined;
    if (!primary) throw new VoiceProviderError('VOICE_PROVIDER_INVALID');

    let emittedAudio = false;
    try {
      for await (const chunk of primary.synthesize(request)) {
        emittedAudio = true;
        yield chunk;
      }
      return;
    } catch (error) {
      if (emittedAudio || request.signal.aborted) throw error;

      const fallback = primary === this.dhvaani ? this.piper : this.dhvaani;
      const fallbackVoice = fallback.voices(request.language)[0]?.id;
      if (!fallbackVoice) throw error;

      const failureCode = this.failureCode(error);
      this.logger.warn(JSON.stringify({
        event: 'voice_tts_provider_fallback',
        primaryEngine: primary.engineId,
        fallbackEngine: fallback.engineId,
        primaryFailureCode: failureCode,
        language: request.language,
        textChars: request.text.length,
      }));

      try {
        yield* fallback.synthesize({ ...request, voice: fallbackVoice });
      } catch (fallbackError) {
        this.logger.error(JSON.stringify({
          event: 'voice_tts_fallback_failed',
          primaryEngine: primary.engineId,
          fallbackEngine: fallback.engineId,
          primaryFailureCode: failureCode,
          fallbackFailureCode: this.failureCode(fallbackError),
          language: request.language,
          textChars: request.text.length,
        }));
        throw fallbackError;
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    const results = await Promise.allSettled([
      this.dhvaani.healthCheck(),
      this.piper.healthCheck(),
    ]);

    return results.some(
      (result) => result.status === 'fulfilled' && result.value,
    );
  }

  private failureCode(error: unknown): string {
    return error instanceof VoiceProviderError ? error.code : 'VOICE_ENGINE_UNAVAILABLE';
  }
}
