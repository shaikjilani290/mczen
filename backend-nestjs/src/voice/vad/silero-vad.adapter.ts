import { Injectable } from '@nestjs/common';
import { fetchWithTimeout, readLoopbackUrl, VoiceProviderError } from '../voice-provider.util';
import type { VadRequest, VadResult, VoiceActivityPort } from './vad.port';

@Injectable()
export class SileroVadAdapter implements VoiceActivityPort {
  readonly engineId = 'silero-vad';
  private readonly endpoint = new URL('/predict', readLoopbackUrl('VOICE_VAD_URL', 'http://127.0.0.1:8002'));

  async detect(request: VadRequest): Promise<VadResult> {
    if (request.audio.data.length !== 640) throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    const response = await fetchWithTimeout(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        streamId: request.streamId,
        audio: request.audio.data.toString('base64'),
        encoding: 'pcm_s16le',
        sampleRate: 16000,
        channels: 1,
      }),
      signal: request.signal,
    }, 500);
    if (!response.ok) throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch {
      throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    }
    if (!isRecord(payload) || typeof payload.speech !== 'boolean' ||
        typeof payload.probability !== 'number' || payload.probability < 0 ||
        payload.probability > 1) {
      throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    }
    return { speech: payload.speech, probability: payload.probability };
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
