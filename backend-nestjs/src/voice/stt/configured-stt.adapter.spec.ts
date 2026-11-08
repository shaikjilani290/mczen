import { Logger } from '@nestjs/common';
import { ConfiguredSttAdapter } from './configured-stt.adapter';
import { FasterWhisperAdapter } from './faster-whisper.adapter';
import type { SttRequest } from './stt.port';
import { VoiceProviderError } from '../voice-provider.util';
import { createServer } from 'node:http';
import { Test } from '@nestjs/testing';
import { VoiceCapabilitiesController } from '../voice-capabilities.controller';
import { SPEECH_TO_TEXT } from './stt.port';
import { TEXT_TO_SPEECH } from '../tts/tts.port';
import { VOICE_ACTIVITY } from '../vad/vad.port';
import { SHARED_STATE } from '../../shared-state/shared-state';

const response = {
  success: true, transcript: 'Recognized speech', language: 'en',
  audio_duration: 7.25, processing_time: 0.43, speed: 16.94,
  device: 'cuda', model: 'small', compute_type: 'int8',
};
const request = (): SttRequest => ({
  audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640, 12) },
  language: 'en', partial: false, signal: new AbortController().signal,
  requestId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
});
const keys = ['MCZEN_STT_PROVIDER', 'MCZEN_STT_URL', 'MCZEN_STT_API_KEY',
  'MCZEN_STT_TIMEOUT_MS', 'MCZEN_STT_FALLBACK_ENABLED'] as const;

describe('configured local/remote STT', () => {
  let saved: Array<string | undefined>;
  let local: FasterWhisperAdapter;
  let localTranscribe: jest.SpiedFunction<FasterWhisperAdapter['transcribe']>;
  let localHealth: jest.SpiedFunction<FasterWhisperAdapter['healthCheck']>;
  let warn: jest.SpiedFunction<Logger['warn']>;
  let logError: jest.SpiedFunction<Logger['error']>;
  beforeEach(() => {
    saved = keys.map(key => process.env[key]);
    for (const key of keys) delete process.env[key];
    process.env.MCZEN_STT_PROVIDER = 'remote';
    process.env.MCZEN_STT_URL = 'https://gpu.example/prefix/';
    process.env.MCZEN_STT_API_KEY = 'test-secret-not-a-real-key';
    local = new FasterWhisperAdapter();
    localTranscribe = jest.spyOn(local, 'transcribe').mockResolvedValue({ text: 'Local transcript', language: 'en', isFinal: true });
    localHealth = jest.spyOn(local, 'healthCheck').mockResolvedValue(true);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  it.each([true, false])('sends catalogue initial_prompt only when advertised by the remote contract: %s', async supported => {
    const fetch = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ paths: { '/prefix/transcribe': { post: { requestBody: {
        content: { 'multipart/form-data': { schema: { properties: supported ? { initial_prompt: { type: 'string' } } : { file: { type: 'string' } } } } },
      } } } } })))
      .mockImplementation(async () => new Response(JSON.stringify(response)));
    const adapter = new ConfiguredSttAdapter(local);
    const input = { ...request(), vocabulary: ['ZENAGE', 'LASS HEALTH', 'WEIZAP', 'HALE.O', 'AURA STRESS FREE COFFEE'] };
    expect((await adapter.transcribe(input)).text).toBe(response.transcript);
    const form = fetch.mock.calls[1][1]?.body;
    if (!(form instanceof FormData)) throw new Error('Expected multipart request.');
    expect(form.has('initial_prompt')).toBe(supported);
    if (supported) expect(form.get('initial_prompt')).toContain('ZENAGE, LASS HEALTH, WEIZAP, HALE.O');
    await adapter.transcribe(input);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(localTranscribe).not.toHaveBeenCalled();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  });

  it('keeps the existing local default and ignores unused remote settings', async () => {
    delete process.env.MCZEN_STT_PROVIDER;
    process.env.MCZEN_STT_URL = 'invalid';
    process.env.MCZEN_STT_TIMEOUT_MS = 'bad';
    const adapter = new ConfiguredSttAdapter(local);
    const input = request();
    expect(await adapter.transcribe(input)).toMatchObject({ text: 'Local transcript' });
    expect(localTranscribe).toHaveBeenCalledWith(input);
    expect(await adapter.healthCheck()).toBe(true);
    expect(adapter.status()).toEqual({ configuredProvider: 'local', localFallbackEnabled: false });
    expect(adapter.engineId).toBe(local.engineId);
    expect(adapter.supportsPartial).toBe(false);
  });
  it.each([true, false])('preserves large-v3 recognition quality and language probability: %s', async reliable => {
    const recognitionQuality = { reliable, reason: reliable ? 'accepted' : 'low_log_probability',
      avgLogProbability: reliable ? -0.2 : -1.2, noSpeechProbability: 0.1 };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...response, model: 'large-v3', compute_type: 'int8_float32',
      languageProbability: 0.95, recognitionQuality, inference_time: 1.25,
    })));
    expect(await new ConfiguredSttAdapter(local).transcribe(request())).toMatchObject({
      text: response.transcript, languageProbability: 0.95, recognitionQuality,
    });
    expect(localTranscribe).not.toHaveBeenCalled();
    expect(Logger.prototype.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'voice_remote_stt_timing', activeModel: 'large-v3', inferenceMs: 1250,
    }));
  });
  it.each([
    { languageProbability: 2 },
    { languageProbability: null },
    { recognitionQuality: { reliable: true, reason: 'low_log_probability' } },
    { recognitionQuality: { reliable: false, reason: 'accepted' } },
    { inference_time: -1 },
  ])('rejects malformed large-v3 quality/timing and retains local fallback: %j', async extra => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...response, ...extra })));
    expect((await new ConfiguredSttAdapter(local).transcribe(request())).text).toBe('Local transcript');
    expect(localTranscribe).toHaveBeenCalledTimes(1);
  });

  it('sends bearer auth/correlation and a lossless WAV file, preserving exact transcript and timings', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response)));
    const adapter = new ConfiguredSttAdapter(local);
    const input = request();
    expect(await adapter.transcribe(input)).toEqual({
      text: response.transcript, language: 'en', isFinal: true, processingMs: 430,
    });
    const [url, init] = fetch.mock.calls[0];
    if (!(url instanceof URL)) throw new Error('Expected URL.');
    expect(url.href).toBe('https://gpu.example/prefix/transcribe');
    expect(init).toMatchObject({
      method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer test-secret-not-a-real-key', 'x-mczen-request-id': input.requestId },
    });
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    const form = init?.body;
    if (!(form instanceof FormData)) throw new Error('Expected multipart body.');
    const file = form.get('file');
    if (!(file instanceof Blob)) throw new Error('Expected a file.');
    expect(file.type).toBe('audio/wav');
    const wav = Buffer.from(await file.arrayBuffer());
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(44).equals(input.audio.data)).toBe(true);
    expect(form.get('language')).toBe('en');
    expect(localTranscribe).not.toHaveBeenCalled();
    expect(JSON.stringify(adapter.status())).not.toContain('secret');
  });

  it.each(['hi', 'te', 'auto'] as const)('preserves %s language handling without changing the returned transcript', async language => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...response, transcript: ' Exact text. ', language: language === 'auto' ? 'hi' : language,
    })));
    const result = await new ConfiguredSttAdapter(local).transcribe({ ...request(), language });
    expect(result.text).toBe(' Exact text. ');
    expect(result.language).toBe(language === 'auto' ? 'hi' : language);
    const form = fetch.mock.calls[0][1]?.body as FormData;
    expect(form.get('language')).toBe(language === 'auto' ? null : language);
  });

  it.each([401, 403, 429, 500, 503, 530, 201])('falls back on non-200 HTTP %s without logging secrets/body', async status => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private response body', { status }));
    const input = request();
    expect(await new ConfiguredSttAdapter(local).transcribe(input)).toMatchObject({ text: 'Local transcript' });
    expect(localTranscribe).toHaveBeenCalledWith(input);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'voice_remote_stt_http_failed', requestId: input.requestId, status,
      durationMs: expect.any(Number),
    }));
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).toContain('VOICE_ENGINE_UNAVAILABLE');
    expect(logs).not.toContain('test-secret');
    expect(logs).not.toContain('private response');
  });

  it.each([
    null, {}, { ...response, success: false }, { ...response, transcript: '' },
    { ...response, transcript: '   ' }, { ...response, transcript: 'a'.repeat(8001) },
    { ...response, language: 'fr' }, { ...response, language: ['en'] }, { ...response, processing_time: -1 },
    { ...response, processing_time: '0.43' }, { ...response, audio_duration: -1 },
  ])('falls back on an invalid response: %j', async payload => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload)));
    expect(await new ConfiguredSttAdapter(local).transcribe(request())).toMatchObject({ text: 'Local transcript' });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'VOICE_PROVIDER_INVALID' }));
  });

  it('falls back on malformed JSON and network failure', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('invalid-json'))
      .mockRejectedValueOnce(new Error('network error with sensitive details'));
    const adapter = new ConfiguredSttAdapter(local);
    await adapter.transcribe(request());
    await adapter.transcribe(request());
    expect(localTranscribe).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive');
  });

  it.each([false, true])('times out including response-body reads; stalled body=%s', async stalledBody => {
    jest.useFakeTimers();
    process.env.MCZEN_STT_TIMEOUT_MS = '40';
    jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      if (stalledBody) return Promise.resolve({
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      } as Response);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const pending = new ConfiguredSttAdapter(local).transcribe(request());
    await jest.advanceTimersByTimeAsync(41);
    expect(await pending).toMatchObject({ text: 'Local transcript' });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'VOICE_PROVIDER_TIMEOUT' }));
  });

  it('does not fallback or send audio after session cancellation', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
    const controller = new AbortController();
    const adapter = new ConfiguredSttAdapter(local);
    const pending = adapter.transcribe({ ...request(), signal: controller.signal }).catch((error: unknown) => error);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
    expect(localTranscribe).not.toHaveBeenCalled();
    const calls = fetch.mock.calls.length;
    await expect(adapter.transcribe({ ...request(), signal: controller.signal }))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it('throws a provider error when fallback is disabled or both providers fail', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unavailable'));
    process.env.MCZEN_STT_FALLBACK_ENABLED = 'false';
    await expect(new ConfiguredSttAdapter(local).transcribe(request()))
      .rejects.toMatchObject({ code: 'VOICE_ENGINE_UNAVAILABLE' });
    expect(localTranscribe).not.toHaveBeenCalled();
    process.env.MCZEN_STT_FALLBACK_ENABLED = 'true';
    localTranscribe.mockRejectedValue(new VoiceProviderError('VOICE_PROVIDER_TIMEOUT'));
    await expect(new ConfiguredSttAdapter(local).transcribe(request()))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({
      event: 'voice_stt_all_providers_failed', localCode: 'VOICE_PROVIDER_TIMEOUT',
    }));
  });

  it('does not silently accept an empty local fallback transcript', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unavailable'));
    localTranscribe.mockResolvedValue({ text: ' ', language: 'en', isFinal: true });
    await expect(new ConfiguredSttAdapter(local).transcribe(request()))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({
      event: 'voice_stt_all_providers_failed',
    }));
  });

  it('does not try local health when fallback is disabled', async () => {
    process.env.MCZEN_STT_FALLBACK_ENABLED = 'false';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await new ConfiguredSttAdapter(local).healthCheck()).toBe(false);
    expect(localHealth).not.toHaveBeenCalled();
  });

  it('rejects invalid PCM before uploading or invoking fallback', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const input = request();
    input.audio.data = Buffer.alloc(639);
    await expect(new ConfiguredSttAdapter(local).transcribe(input))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
    expect(localTranscribe).not.toHaveBeenCalled();
  });

  it('exposes configured provider in the existing authenticated capabilities response without endpoint or key', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const module = await Test.createTestingModule({
      controllers: [VoiceCapabilitiesController],
      providers: [
        { provide: SPEECH_TO_TEXT, useValue: new ConfiguredSttAdapter(local) },
        { provide: TEXT_TO_SPEECH, useValue: {
          engineId: 'piper', healthCheck: async () => true, supports: () => true, voices: () => [],
        } },
        { provide: VOICE_ACTIVITY, useValue: { engineId: 'silero-vad', healthCheck: async () => true } },
        { provide: SHARED_STATE, useValue: { driver: 'memory' } },
      ],
    }).compile();
    try {
      const result = await module.get(VoiceCapabilitiesController).capabilities();
      expect(result.providers.stt).toMatchObject({
        engine: local.engineId, healthy: true, configuredProvider: 'remote',
        localFallbackEnabled: true, timeoutMs: 15000,
      });
      expect(JSON.stringify(result)).not.toContain('test-secret');
      expect(JSON.stringify(result)).not.toContain('gpu.example');
    } finally { await module.close(); }
  });

  it('uses the real HTTP multipart transport with synthetic PCM, no external audio upload', async () => {
    let received: { url?: string; auth?: string; type?: string; correlation?: string; body: Buffer } | undefined;
    const server = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        received = {
          url: incoming.url, auth: incoming.headers.authorization, type: incoming.headers['content-type'],
          correlation: typeof incoming.headers['x-mczen-request-id'] === 'string'
            ? incoming.headers['x-mczen-request-id'] : undefined,
          body: Buffer.concat(chunks),
        };
        outgoing.writeHead(200, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify(response));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener.');
      process.env.MCZEN_STT_URL = `http://127.0.0.1:${address.port}/api`;
      const input = request();
      expect(await new ConfiguredSttAdapter(local).transcribe(input)).toMatchObject({
        text: response.transcript, processingMs: 430,
      });
      expect(received).toMatchObject({
        url: '/api/transcribe', auth: 'Bearer test-secret-not-a-real-key', correlation: input.requestId,
      });
      expect(received?.type).toMatch(/^multipart\/form-data; boundary=/);
      expect(received?.body.toString('latin1')).toContain('name="file"; filename="audio.wav"');
      expect(received?.body.includes(input.audio.data)).toBe(true);
      expect(localTranscribe).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('checks authenticated health, reports sanitized status and uses enabled health fallback', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const adapter = new ConfiguredSttAdapter(local);
    expect(await adapter.healthCheck()).toBe(true);
    const healthUrl = fetch.mock.calls[0][0];
    if (!(healthUrl instanceof URL)) throw new Error('Expected URL.');
    expect(healthUrl.href).toBe('https://gpu.example/prefix/health');
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer test-secret-not-a-real-key' },
    });
    expect(adapter.status()).toEqual({ configuredProvider: 'remote', localFallbackEnabled: true, timeoutMs: 15000 });
    expect(await adapter.healthCheck()).toBe(true);
    expect(localHealth).toHaveBeenCalledTimes(1);
    localHealth.mockResolvedValue(false);
    fetch.mockRejectedValue(new Error('down'));
    expect(await adapter.healthCheck()).toBe(false);
  });

  it.each([
    ['MCZEN_STT_PROVIDER', 'typo'], ['MCZEN_STT_URL', 'invalid'],
    ['MCZEN_STT_URL', 'http://remote.example'], ['MCZEN_STT_URL', 'https://user:secret@gpu.example'],
    ['MCZEN_STT_URL', 'https://gpu.example?token=secret'], ['MCZEN_STT_API_KEY', ''],
    ['MCZEN_STT_API_KEY', 'secret\r\nbad'], ['MCZEN_STT_TIMEOUT_MS', 'NaN'],
    ['MCZEN_STT_TIMEOUT_MS', '0'], ['MCZEN_STT_TIMEOUT_MS', '120001'],
    ['MCZEN_STT_FALLBACK_ENABLED', 'yes'],
  ])('rejects invalid %s configuration without echoing its value', (key, value) => {
    process.env[key] = value;
    expect(() => new ConfiguredSttAdapter(local)).toThrow();
  });
});
