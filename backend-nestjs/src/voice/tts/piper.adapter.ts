import { Injectable } from '@nestjs/common';
import type { VoiceLanguage } from '../voice.types';
import { fetchWithTimeout, readLoopbackUrl, Semaphore, VoiceProviderError } from '../voice-provider.util';
import type { TextToSpeechPort, TtsAudioChunk, TtsRequest, TtsVoiceOption } from './tts.port';

const PIPER_VOICES: Readonly<Record<VoiceLanguage, readonly TtsVoiceOption[]>> = {
  en: [
    { id: 'en_US-amy-medium', label: 'Amy', gender: 'female', language: 'en' },
    { id: 'en_US-lessac-medium', label: 'Lessac', gender: 'male', language: 'en' },
    { id: 'en_GB-alan-medium', label: 'Alan', gender: 'male', language: 'en' },
    { id: 'en_GB-alba-medium', label: 'Alba', gender: 'female', language: 'en' },
  ],
  hi: [
    { id: 'hi_IN-pratham-medium', label: 'Pratham', gender: 'male', language: 'hi' },
    { id: 'hi_IN-priyamvada-medium', label: 'Priyamvada', gender: 'female', language: 'hi' },
  ],
  te: [],
};
const MAX_TTS_BYTES = 1_920_000;

@Injectable()
export class PiperAdapter implements TextToSpeechPort {
  readonly engineId = 'piper';
  private readonly endpoint = new URL('/synthesize', readLoopbackUrl('VOICE_TTS_URL', 'http://127.0.0.1:8003'));
  private readonly slots = new Semaphore(2, 8);

  supports(language: VoiceLanguage): boolean {
    return PIPER_VOICES[language].length > 0;
  }

  supportsVoice(language: VoiceLanguage, voice: string): boolean {
    return PIPER_VOICES[language].some((option) => option.id === voice);
  }

  voices(language: VoiceLanguage): readonly TtsVoiceOption[] {
    return PIPER_VOICES[language];
  }

  async *synthesize(request: TtsRequest): AsyncIterable<TtsAudioChunk> {
    if (!this.supports(request.language) || !this.supportsVoice(request.language, request.voice) ||
        request.text.trim().length === 0 || request.text.length > 2_000 ||
        !Number.isFinite(request.rate) || request.rate < 0.5 || request.rate > 2) {
      throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    }
    // Piper emits its first audio only after a whole sentence is synthesized.
    // Bound inference per request, including slower configured speech rates.
    const limit = Math.floor(120 * Math.min(request.rate, 1));
    let text = request.text.trim();
    while (text.length > limit) {
      const space = text.lastIndexOf(' ', limit);
      const boundary = space > 0 ? space : limit;
      yield* this.synthesizeSegment({ ...request, text: text.slice(0, boundary) });
      text = text.slice(boundary).trimStart();
    }
    if (text) yield* this.synthesizeSegment({ ...request, text });
  }

  private async *synthesizeSegment(request: TtsRequest): AsyncIterable<TtsAudioChunk> {
    const release = await this.slots.acquire(request.signal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetchWithTimeout(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-mczen-pcm' },
        body: JSON.stringify({
          text: request.text,
          language: request.language,
          voice: request.voice,
          rate: request.rate,
          encoding: 'pcm_s16le',
          sampleRate: 16000,
          stream: true,
        }),
        signal: request.signal,
      }, 12_000);
      if (!response.ok || !response.body) throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
      const encoding = response.headers.get('x-audio-encoding');
      const sampleRate = Number(response.headers.get('x-audio-sample-rate'));
      if (encoding !== 'pcm_s16le' || sampleRate !== 16000) {
        await response.body.cancel();
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      reader = response.body.getReader();
      let total = 0;
      let carry = Buffer.alloc(0);
      while (true) {
        if (request.signal.aborted) throw new VoiceProviderError('VOICE_PROVIDER_TIMEOUT');
        const { done, value } = await this.readChunk(reader, request.signal);
        if (done) break;
        total += value.byteLength;
        if (total > MAX_TTS_BYTES) throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
        const data = Buffer.concat([carry, Buffer.from(value)]);
        const evenLength = data.length & ~1;
        if (evenLength > 0) {
          yield {
            encoding: 'pcm_s16le',
            sampleRate: 16000,
            data: data.subarray(0, evenLength),
          };
        }
        carry = data.subarray(evenLength);
      }
      if (carry.length) throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    } finally {
      if (reader) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      release();
    }
  }

  private async readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
    let rejectWait: (error: VoiceProviderError) => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => { rejectWait = reject; });
    const onAbort = () => rejectWait(new VoiceProviderError('VOICE_PROVIDER_TIMEOUT'));
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(onAbort, 12_000);
    if (signal.aborted) onAbort();
    try {
      return await Promise.race([reader.read(), cancelled]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
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
