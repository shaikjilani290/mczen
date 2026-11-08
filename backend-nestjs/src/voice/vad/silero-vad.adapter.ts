import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fetchWithTimeout, readLoopbackUrl, Semaphore, VoiceProviderError } from '../voice-provider.util';
import type { VadRequest, VadResult, VoiceActivityPort } from './vad.port';

@Injectable()
export class SileroVadAdapter implements VoiceActivityPort {
  readonly engineId = 'silero-vad';
  private readonly logger = new Logger(SileroVadAdapter.name);
  private readonly slots = new Semaphore(2, 16);
  private lastLoggedAt = -Infinity;
  private readonly endpoint = new URL('/predict', readLoopbackUrl('VOICE_VAD_URL', 'http://127.0.0.1:8002'));

  async detect(request: VadRequest): Promise<VadResult> {
    if (request.audio.data.length !== 640) throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    return (await this.detectBatch(request))[0];
  }

  async detectBatch(request: VadRequest): Promise<VadResult[]> {
    const started = performance.now();
    const requestId = randomUUID();
    let phase = 'validation';
    let status: number | undefined;
    let release: (() => void) | undefined;
    let admittedAt: number | undefined;
    let serviceTiming: Record<string, number> = {};
    let deadlineExpired = false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(() => { deadlineExpired = true; abort(); }, 500);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) controller.abort();
    try {
      if (!request.streamId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.streamId) ||
        request.audio.encoding !== 'pcm_s16le' || request.audio.sampleRate !== 16000 || request.audio.channels !== 1 ||
        !request.audio.data.length || request.audio.data.length > 14_080 || request.audio.data.length % 640) {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      phase = 'queue';
      release = await this.slots.acquire(controller.signal);
      admittedAt = performance.now();
      phase = 'http';
      const payload = await fetchWithTimeout(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mczen-request-id': requestId },
        body: JSON.stringify({
          streamId: request.streamId,
          audio: request.audio.data.toString('base64'),
          encoding: 'pcm_s16le',
          sampleRate: 16000,
          channels: 1,
        }),
        signal: controller.signal,
      }, 500, async (response): Promise<unknown> => {
        status = response.status;
        if (!response.ok) {
          await response.body?.cancel();
          throw new VoiceProviderError(response.status === 422 ? 'VOICE_PROVIDER_INVALID' : 'VOICE_ENGINE_UNAVAILABLE');
        }
        phase = 'response';
        try {
          return await response.json() as unknown;
        } catch {
          throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
        }
      });
      const frames: unknown[] = isRecord(payload) && Array.isArray(payload.frames) ? payload.frames : [payload];
      phase = 'response_validation';
      if (frames.length !== request.audio.data.length / 640 || !frames.every(isVadResult)) {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      if (isRecord(payload)) {
        for (const key of ['processingMs', 'queueMs', 'dispatchMs', 'eventLoopLagMs', 'sileroLockWaitMs', 'sileroInferenceMs']) {
          const value = payload[key];
          if (value !== undefined) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
              throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
            }
            serviceTiming[key] = value;
          }
        }
      }
      if (controller.signal.aborted) throw new VoiceProviderError('VOICE_PROVIDER_TIMEOUT');
      const now = performance.now();
      if (now - started >= 100 || now - this.lastLoggedAt >= 5000) {
        this.lastLoggedAt = now;
        this.logger.debug({
          event: 'voice_vad_request', requestId, endpoint: this.endpoint.origin + this.endpoint.pathname,
          sessionId: request.streamId, queueMs: admittedAt - started,
          serviceTiming, serviceState: 'responding',
          method: 'POST', status, durationMs: Math.round(now - started),
          bytes: request.audio.data.length, frames: frames.length, validation: 'passed',
        });
      }
      return frames;
    } catch (error) {
      const failure = error instanceof VoiceProviderError ? error
        : new VoiceProviderError(controller.signal.aborted ? 'VOICE_PROVIDER_TIMEOUT' : 'VOICE_PROVIDER_INVALID');
      this.logger.warn({
        event: 'voice_vad_request_failed', requestId, endpoint: this.endpoint.origin + this.endpoint.pathname,
        sessionId: request.streamId, queueMs: (admittedAt ?? performance.now()) - started,
        timeoutReason: request.signal.aborted ? 'session_cancelled'
          : deadlineExpired ? 'request_deadline' : failure.code === 'VOICE_PROVIDER_TIMEOUT' ? 'http_deadline' : undefined,
        serviceState: status === undefined ? 'no_response' : 'responding',
        deadlineMs: 500,
        deadlineOvershootMs: deadlineExpired ? Math.max(0, performance.now() - started - 500) : undefined,
        method: 'POST', phase, status, durationMs: Math.round(performance.now() - started),
        bytes: request.audio.data.length, code: failure.code,
      });
      throw failure;
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      release?.();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isVadResult(value: unknown): value is VadResult {
  return isRecord(value) && typeof value.speech === 'boolean' &&
    typeof value.probability === 'number' && Number.isFinite(value.probability) &&
    value.probability >= 0 && value.probability <= 1;
}
