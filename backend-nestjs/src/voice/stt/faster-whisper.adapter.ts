import { Injectable } from '@nestjs/common';
import type { VoiceLanguage } from '../voice.types';
import { fetchWithTimeout, readLoopbackUrl, Semaphore, VoiceProviderError } from '../voice-provider.util';
import type { SpeechToTextPort, SttRequest, SttResult } from './stt.port';

const LANGUAGES = new Set<VoiceLanguage>(['en', 'hi', 'te']);

@Injectable()
export class FasterWhisperAdapter implements SpeechToTextPort {
  readonly engineId = process.env.VOICE_STT_ENGINE_ID ?? 'faster-whisper-small-int8';
  private readonly endpoint = new URL('/transcribe', readLoopbackUrl('VOICE_STT_URL', 'http://127.0.0.1:8001'));
  private readonly slots = new Semaphore(2, 8);

  transcribe(request: SttRequest): Promise<SttResult> {
    if (request.audio.data.length < 640 || request.audio.data.length > 640_000 ||
        request.audio.data.length % 2 !== 0) {
      throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    }
    return this.slots.run(async () => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(request.audio.data)], { type: 'application/octet-stream' }), 'audio.pcm');
      form.append('encoding', 'pcm_s16le');
      form.append('sample_rate', '16000');
      form.append('channels', '1');
      form.append('partial', String(request.partial));
      form.append('model', this.engineId);
      if (request.language !== 'auto') form.append('language', request.language);

      const response = await fetchWithTimeout(this.endpoint, {
        method: 'POST',
        body: form,
        signal: request.signal,
      }, request.partial ? 12_000 : 45_000);
      if (!response.ok) throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
      let payload: unknown;
      try {
        payload = await response.json() as unknown;
      } catch {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      if (!isRecord(payload) || typeof payload.text !== 'string' ||
          payload.text.length > 8_000 || typeof payload.language !== 'string' ||
          !LANGUAGES.has(payload.language as VoiceLanguage)) {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      const confidence = payload.confidence;
      if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      return {
        text: payload.text,
        language: payload.language as VoiceLanguage,
        confidence: confidence as number | undefined,
        isFinal: !request.partial,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(new URL('/health', this.endpoint), { method: 'GET' }, 1500);
      return response.ok;
    } catch {
      return false;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
