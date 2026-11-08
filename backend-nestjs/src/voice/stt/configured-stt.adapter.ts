import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { fetchWithTimeout, Semaphore, VoiceProviderError } from '../voice-provider.util';
import { FasterWhisperAdapter, isRecognitionQuality } from './faster-whisper.adapter';
import type { SpeechToTextPort, SttRequest, SttResult } from './stt.port';
import type { VoiceLanguage } from '../voice.types';

@Injectable()
export class ConfiguredSttAdapter implements SpeechToTextPort {
  readonly supportsPartial = false;
  readonly engineId: string;
  private readonly logger = new Logger(ConfiguredSttAdapter.name);
  private readonly slots = new Semaphore(2, 8);
  private readonly provider: 'local' | 'remote';
  private readonly fallbackEnabled: boolean;
  private readonly endpoint?: URL;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private promptSupport?: Promise<boolean>;

  constructor(private readonly local: FasterWhisperAdapter) {
    this.engineId = local.engineId;
    const provider = process.env.MCZEN_STT_PROVIDER ?? 'local';
    if (provider !== 'local' && provider !== 'remote') {
      throw new ServiceUnavailableException('MCZEN_STT_PROVIDER must be local or remote.');
    }
    this.provider = provider;
    this.fallbackEnabled = false;
    this.timeoutMs = 15_000;
    if (provider === 'local') return;

    const fallback = process.env.MCZEN_STT_FALLBACK_ENABLED ?? 'true';
    if (fallback !== 'true' && fallback !== 'false') {
      throw new ServiceUnavailableException('MCZEN_STT_FALLBACK_ENABLED must be true or false.');
    }
    this.fallbackEnabled = fallback === 'true';
    const timeout = process.env.MCZEN_STT_TIMEOUT_MS ?? '15000';
    if (!/^\d+$/.test(timeout) || !Number.isSafeInteger(Number(timeout)) ||
        Number(timeout) < 1 || Number(timeout) > 120_000) {
      throw new ServiceUnavailableException('MCZEN_STT_TIMEOUT_MS must be an integer from 1 to 120000.');
    }
    this.timeoutMs = Number(timeout);
    this.apiKey = process.env.MCZEN_STT_API_KEY?.trim();
    if (!this.apiKey || /[\r\n]/.test(this.apiKey)) {
      throw new ServiceUnavailableException('MCZEN_STT_API_KEY is required for remote STT.');
    }
    let base: URL;
    try {
      base = new URL(process.env.MCZEN_STT_URL ?? '');
    } catch {
      throw new ServiceUnavailableException('MCZEN_STT_URL must be an HTTPS base URL.');
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
        base.username || base.password || base.search || base.hash) {
      throw new ServiceUnavailableException('MCZEN_STT_URL must be HTTPS (HTTP only on loopback), without credentials, query or fragment.');
    }
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
    this.endpoint = new URL('transcribe', base);
  }

  status() {
    return {
      configuredProvider: this.provider,
      localFallbackEnabled: this.fallbackEnabled,
      ...(this.provider === 'remote' ? { timeoutMs: this.timeoutMs } : {}),
    };
  }

  async transcribe(request: SttRequest): Promise<SttResult> {
    if (this.provider === 'local') return this.local.transcribe(request);
    if (request.signal.aborted) throw new VoiceProviderError('VOICE_PROVIDER_TIMEOUT');
    if (request.audio.encoding !== 'pcm_s16le' || request.audio.sampleRate !== 16000 ||
        request.audio.channels !== 1 || request.audio.data.length < 640 ||
        request.audio.data.length > 640_000 || request.audio.data.length % 2 ||
        !['auto', 'en', 'hi', 'te'].includes(request.language)) {
      throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
    }
    try {
      return await this.slots.run(() => this.remoteTranscribe(request), request.signal);
    } catch (error) {
      const failure = error instanceof VoiceProviderError ? error : new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
      this.logger.warn({
        event: 'voice_remote_stt_failed', requestId: request.requestId,
        code: failure.code, cancelled: request.signal.aborted,
        localFallback: this.fallbackEnabled && !request.signal.aborted,
      });
      if (request.signal.aborted || !this.fallbackEnabled) throw failure;
      try {
        const result = await this.local.transcribe(request);
        if (!result.text.trim()) throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
        return result;
      } catch (localError) {
        const localFailure = localError instanceof VoiceProviderError
          ? localError : new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
        this.logger.error({
          event: 'voice_stt_all_providers_failed', requestId: request.requestId,
          remoteCode: failure.code, localCode: localFailure.code,
        });
        throw localFailure;
      }
    }
  }

  private async remoteTranscribe(request: SttRequest): Promise<SttResult> {
    if (!this.endpoint || !this.apiKey) throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(pcmWav(request.audio.data))], { type: 'audio/wav' }), 'audio.wav');
    if (request.language !== 'auto') form.append('language', request.language);
    const vocabulary = (request.vocabulary ?? []).filter(name => name.length <= 120 &&
      /^[\p{L}\p{N} .&'()+-]+$/u.test(name)).slice(0, 40);
    if (vocabulary.length) {
      const supported = await (this.promptSupport ??= this.supportsInitialPrompt());
      let prompt = 'Product names: ';
      let promptedNames = 0;
      if (supported) {
        for (const name of vocabulary) {
          if (prompt.length + name.length + 3 > 2000) break;
          prompt += `${promptedNames ? ', ' : ''}${name}`;
          promptedNames++;
        }
        form.append('initial_prompt', `${prompt}.`);
      }
      this.logger.log({ event: 'voice_stt_vocabulary', requestId: request.requestId,
        provider: 'remote', vocabularyCount: vocabulary.length, promptedNames, initialPromptSent: supported });
    }
    const started = performance.now();
    return fetchWithTimeout(this.endpoint, {
      method: 'POST', redirect: 'error', body: form, signal: request.signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(request.requestId ? { 'x-mczen-request-id': request.requestId } : {}),
      },
    }, this.timeoutMs, async response => {
      if (response.status !== 200) {
        await response.body?.cancel();
        this.logger.warn({
          event: 'voice_remote_stt_http_failed', requestId: request.requestId,
          status: response.status, durationMs: performance.now() - started,
        });
        throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
      }
      let payload: unknown;
      try { payload = await response.json() as unknown; } catch {
        throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      }
      if (!isRemoteResult(payload)) throw new VoiceProviderError('VOICE_PROVIDER_INVALID');
      this.logger.log({
        event: 'voice_remote_stt_timing', requestId: request.requestId,
        provider: 'remote', durationMs: performance.now() - started,
        processingMs: payload.processing_time * 1000, audioMs: payload.audio_duration * 1000,
        ...(typeof payload.model === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(payload.model) ? { activeModel: payload.model } : {}),
        ...(typeof payload.inference_time === 'number' ? { inferenceMs: payload.inference_time * 1000 } : {}),
      });
      return {
        text: payload.transcript, language: payload.language,
        isFinal: !request.partial, processingMs: payload.processing_time * 1000,
        ...(payload.languageProbability === undefined ? {} : { languageProbability: payload.languageProbability }),
        ...(payload.recognitionQuality === undefined ? {} : { recognitionQuality: payload.recognitionQuality }),
      };
    });
  }

  private async supportsInitialPrompt(): Promise<boolean> {
    if (!this.endpoint) return false;
    try {
      return await fetchWithTimeout(new URL('openapi.json', new URL('.', this.endpoint)), {
        method: 'GET', redirect: 'error',
      }, 1500, async response => {
        if (!response.ok) {
          await response.body?.cancel();
          throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
        }
        const spec: unknown = await response.json();
        const schema = record(spec) && record(spec.paths) && record(spec.paths[this.endpoint!.pathname])
          ? spec.paths[this.endpoint!.pathname] : undefined;
        const post = record(schema) && record(schema.post) ? schema.post : undefined;
        const body = record(post) && record(post.requestBody) ? post.requestBody : undefined;
        const content = record(body) && record(body.content) ? body.content : undefined;
        const multipart = record(content) && record(content['multipart/form-data']) ? content['multipart/form-data'] : undefined;
        let fields: unknown = record(multipart) ? multipart.schema : undefined;
        if (record(fields) && typeof fields.$ref === 'string' && fields.$ref.startsWith('#/components/schemas/')) {
          const components = record(spec) && record(spec.components) ? spec.components : undefined;
          const schemas = record(components) && record(components.schemas) ? components.schemas : undefined;
          fields = record(schemas) ? schemas[fields.$ref.slice('#/components/schemas/'.length)] : undefined;
        }
        const properties = record(fields) && record(fields.properties) ? fields.properties : undefined;
        const prompt = record(properties) ? properties.initial_prompt : undefined;
        const supported = record(prompt) && (prompt.type === 'string' ||
          (Array.isArray(prompt.anyOf) && prompt.anyOf.some(option => record(option) && option.type === 'string')));
        if (!supported) this.logger.warn({ event: 'voice_stt_vocabulary_unsupported', provider: 'remote' });
        return supported;
      });
    } catch {
      this.logger.warn({ event: 'voice_stt_vocabulary_contract_unavailable', provider: 'remote' });
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (this.provider === 'local') return this.local.healthCheck();
    if (!this.endpoint || !this.apiKey) return false;
    try {
      const healthy = await fetchWithTimeout(new URL('health', new URL('.', this.endpoint)), {
        method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${this.apiKey}` },
      }, Math.min(this.timeoutMs, 5000), async response => {
        await response.body?.cancel();
        return response.status === 200;
      });
      if (healthy) return true;
    } catch {
      // Health callers need a boolean; detailed transcription failures use the normal error path.
    }

    this.logger.warn({ event: 'voice_remote_stt_health_failed', localFallback: this.fallbackEnabled });
    return this.fallbackEnabled ? this.local.healthCheck() : false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRemoteResult(value: unknown): value is {
  transcript: string; language: VoiceLanguage; processing_time: number; audio_duration: number;
  languageProbability?: number; recognitionQuality?: SttResult['recognitionQuality'];
  model?: unknown; inference_time?: number;
} {
  if (value === null || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return payload.success === true && typeof payload.transcript === 'string' &&
    payload.transcript.trim().length > 0 && payload.transcript.length <= 8000 &&
    typeof payload.language === 'string' && ['en', 'hi', 'te'].includes(payload.language) &&
    typeof payload.processing_time === 'number' && Number.isFinite(payload.processing_time) &&
    payload.processing_time >= 0 && Number.isFinite(payload.processing_time * 1000) &&
    typeof payload.audio_duration === 'number' && Number.isFinite(payload.audio_duration) &&
    payload.audio_duration >= 0 && Number.isFinite(payload.audio_duration * 1000) &&
    (payload.languageProbability === undefined || (typeof payload.languageProbability === 'number' &&
      Number.isFinite(payload.languageProbability) && payload.languageProbability >= 0 && payload.languageProbability <= 1)) &&
    (payload.recognitionQuality === undefined || isRecognitionQuality(payload.recognitionQuality)) &&
    (payload.inference_time === undefined || (typeof payload.inference_time === 'number' &&
      Number.isFinite(payload.inference_time) && payload.inference_time >= 0 &&
      Number.isFinite(payload.inference_time * 1000)));
}

function pcmWav(pcm: Buffer): Buffer {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}
