import { Injectable, Logger } from '@nestjs/common';
import type { VoiceLanguage } from '../voice.types';
import { fetchWithTimeout, readLoopbackUrl, Semaphore, VoiceProviderError } from '../voice-provider.util';
import type { SpeechToTextPort, SttRequest, SttResult, SttTimings } from './stt.port';

const LANGUAGES = new Set<VoiceLanguage>(['en', 'hi', 'te']);

@Injectable()
export class FasterWhisperAdapter implements SpeechToTextPort {
  readonly engineId = process.env.VOICE_STT_ENGINE_ID ?? 'faster-whisper-small-int8';
  // Local synchronous inference keeps running after an HTTP preview is cancelled.
  readonly supportsPartial = false;
  private readonly logger = new Logger(FasterWhisperAdapter.name);
  private readonly endpoint = new URL('/transcribe', readLoopbackUrl('VOICE_STT_URL', 'http://127.0.0.1:8001'));
  private readonly slots = new Semaphore(2, 8);

  transcribe(request: SttRequest): Promise<SttResult> {
    if (request.audio.data.length < 640 || request.audio.data.length > 640_000 ||
        request.audio.data.length % 2 !== 0) {
      throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    }
    const queuedAt = performance.now();
    return this.slots.run(async () => {
      const started = performance.now();
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(request.audio.data)], { type: 'application/octet-stream' }), 'audio.pcm');
      form.append('encoding', 'pcm_s16le');
      form.append('sample_rate', '16000');
      form.append('channels', '1');
      form.append('partial', String(request.partial));
      form.append('model', this.engineId);
      if (request.language !== 'auto') form.append('language', request.language);

      return fetchWithTimeout(this.endpoint, {
        method: 'POST',
        body: form,
        ...(request.requestId ? { headers: { 'x-mczen-request-id': request.requestId } } : {}),
        signal: request.signal,
      }, request.partial ? 12_000 : 45_000, async response => {
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
      const processingMs = payload.processingMs;
      if (processingMs !== undefined && (typeof processingMs !== 'number' || !Number.isFinite(processingMs) || processingMs < 0)) {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      const quality = payload.recognitionQuality;
      if (quality !== undefined && !isRecognitionQuality(quality)) {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      const timings = payload.timings;
      if (timings !== undefined && !isSttTimings(timings)) {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      this.logger.log({
        event: 'voice_stt_request_timing', requestId: request.requestId, partial: request.partial,
        engineId: this.engineId, queueMs: started - queuedAt, durationMs: performance.now() - started,
        processingMs, timings, audioMs: request.audio.data.length / 32, status: response.status,
      });
      return {
        text: payload.text,
        language: payload.language as VoiceLanguage,
        confidence: confidence as number | undefined,
        isFinal: !request.partial,
        ...(typeof processingMs === 'number' ? { processingMs } : {}),
        ...(quality === undefined ? {} : { recognitionQuality: quality }),
        ...(timings === undefined ? {} : { timings }),
      };
      });
    }, request.signal);
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

function isSttTimings(value: unknown): value is SttTimings {
  return isRecord(value) && [
    'dispatchMs', 'preprocessingMs', 'queueMs', 'inferenceMs',
    'featureMs', 'encoderMs', 'decoderMs', 'postprocessingMs',
  ].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0);
}

function isRecognitionQuality(value: unknown): value is NonNullable<SttResult['recognitionQuality']> {
  if (!isRecord(value) || typeof value.reliable !== 'boolean' ||
      !['accepted', 'no_speech', 'low_log_probability', 'likely_no_speech'].includes(String(value.reason))) return false;
  if ((value.reason === 'accepted') !== value.reliable) return false;
  for (const key of ['audioRms', 'audioPeak', 'clippedFraction']) {
    const level = value[key];
    if (level !== undefined && (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1)) return false;
  }
  return (value.avgLogProbability === undefined || (typeof value.avgLogProbability === 'number' &&
    Number.isFinite(value.avgLogProbability) && value.avgLogProbability <= 0)) &&
    (value.noSpeechProbability === undefined || (typeof value.noSpeechProbability === 'number' &&
      Number.isFinite(value.noSpeechProbability) && value.noSpeechProbability >= 0 && value.noSpeechProbability <= 1));
}
