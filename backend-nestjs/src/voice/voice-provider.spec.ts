import { FasterWhisperAdapter } from './stt/faster-whisper.adapter';
import { SileroVadAdapter } from './vad/silero-vad.adapter';
import { PiperAdapter } from './tts/piper.adapter';
import { fetchWithTimeout, Semaphore, VoiceProviderError, readLoopbackUrl } from './voice-provider.util';

describe('voice provider adapters', () => {
  afterEach(() => jest.restoreAllMocks());

  it('limits provider URLs to loopback services', () => {
    expect(readLoopbackUrl('VOICE_TEST_URL', 'http://127.0.0.1:8001').hostname).toBe('127.0.0.1');
    const previous = process.env.VOICE_TEST_URL;
    process.env.VOICE_TEST_URL = 'http://example.invalid:8001';
    try {
      expect(() => readLoopbackUrl('VOICE_TEST_URL', 'http://127.0.0.1:8001')).toThrow(
        'VOICE_TEST_URL must point to a loopback HTTP service.',
      );
    } finally {
      if (previous === undefined) delete process.env.VOICE_TEST_URL;
      else process.env.VOICE_TEST_URL = previous;
    }
  });

  it.each([0.5, 1, 2])('splits long Piper input into ordered bounded requests at rate %s without losing text', async rate => {
    const text = 'Ingredients include hyaluronic acid, vitamin C, niacinamide, grape seed extract and zinc. '.repeat(6).trim();
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      new Uint8Array([1, 2]), { headers: { 'x-audio-encoding': 'pcm_s16le', 'x-audio-sample-rate': '16000' } },
    ));
    const output: Buffer[] = [];
    for await (const chunk of new PiperAdapter().synthesize({
      text, language: 'en', voice: 'en_US-amy-medium', rate, signal: new AbortController().signal,
    })) output.push(chunk.data);
    const segments = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).text as string);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every(segment => segment.length <= Math.floor(120 * Math.min(rate, 1)))).toBe(true);
    expect(segments.join(' ')).toBe(text);
    expect(Buffer.concat(output)).toEqual(Buffer.from(Array.from({ length: segments.length }, () => [1, 2]).flat()));
  });

  it('does not start another Piper segment after interruption', async () => {
    const controller = new AbortController();
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      new Uint8Array([1, 2]), { headers: { 'x-audio-encoding': 'pcm_s16le', 'x-audio-sample-rate': '16000' } },
    ));
    const output = (async () => {
      for await (const _chunk of new PiperAdapter().synthesize({
        text: 'Recorded product information. '.repeat(10), language: 'en',
        voice: 'en_US-amy-medium', rate: 1, signal: controller.signal,
      })) controller.abort();
    })();
    await expect(output).rejects.toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('validates Faster-Whisper responses and submits an explicit language hint', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      text: ' नमस्ते ',
      language: 'hi',
      confidence: 0.96,
    }), { headers: { 'Content-Type': 'application/json' } }));
    const adapter = new FasterWhisperAdapter();
    const result = await adapter.transcribe({
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
      language: 'hi',
      partial: false,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ text: ' नमस्ते ', language: 'hi', confidence: 0.96, isFinal: true });
    const form = fetch.mock.calls[0][1]?.body as FormData;
    expect(form.get('language')).toBe('hi');
    expect(form.get('partial')).toBe('false');
  });

  it('reports batch STT capability and carries validated service processing timing', async () => {
      const timings = { dispatchMs: 1, preprocessingMs: 2, queueMs: 0, inferenceMs: 120,
        featureMs: 10, encoderMs: 90, decoderMs: 15, postprocessingMs: 0.5 };
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        text: 'Hello.', language: 'en', processingMs: 123.5, timings,
      })));
      const adapter = new FasterWhisperAdapter();
      expect(adapter.supportsPartial).toBe(false);
      expect(await adapter.transcribe({
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
        language: 'en', partial: false, signal: new AbortController().signal,
      })).toMatchObject({ processingMs: 123.5, timings });
    });

  it.each([null, {}, { encoderMs: -1 }, {
    dispatchMs: 0, preprocessingMs: 0, queueMs: 0, inferenceMs: 1,
    featureMs: 0, encoderMs: '1', decoderMs: 0, postprocessingMs: 0,
  }])('rejects malformed STT stage timings', async timings => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      text: 'Open my cart.', language: 'en', timings,
    })));
    await expect(new FasterWhisperAdapter().transcribe({
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
      language: 'en', partial: false, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
  });
  it('sends a bounded local STT vocabulary prompt without splitting product names', async () => {
    const request = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      text: 'Explain ZENAGE.', language: 'en',
    })));
    const adapter = new FasterWhisperAdapter();
    const input = {
      audio: { encoding: 'pcm_s16le' as const, sampleRate: 16000 as const, channels: 1 as const, data: Buffer.alloc(640) },
      language: 'en' as const, partial: false, signal: new AbortController().signal,
    };
    await adapter.transcribe({ ...input, vocabulary: ['ZENAGE', 'LASS HEALTH', 'WEIZAP', 'HALE.O', 'AURA STRESS FREE COFFEE'] });
    const body = request.mock.calls[0][1]?.body;
    if (!(body instanceof FormData)) throw new Error('Expected multipart request.');
    expect(body.get('initial_prompt')).toBe('Product names: ZENAGE, LASS HEALTH, WEIZAP, HALE.O, AURA STRESS FREE COFFEE.');
    await adapter.transcribe({ ...input, vocabulary: ['ZENAGE', 'x'.repeat(121), 'invalid\nname',
      ...Array.from({ length: 50 }, (_, index) => `PRODUCT ${index}`)] });
    const bounded = request.mock.calls[1][1]?.body;
    if (!(bounded instanceof FormData)) throw new Error('Expected multipart request.');
    const prompt = bounded.get('initial_prompt');
    expect(typeof prompt).toBe('string');
    expect(String(prompt).length).toBeLessThanOrEqual(200);
    expect(prompt).not.toContain('invalid');
    expect(String(prompt)).toMatch(/(?:ZENAGE|PRODUCT \d+)\.$/);
    await adapter.transcribe(input);
    const noVocabulary = request.mock.calls[2][1]?.body;
    if (!(noVocabulary instanceof FormData)) throw new Error('Expected multipart request.');
    expect(noVocabulary.has('initial_prompt')).toBe(false);
  });
  it('preserves the local provider language detection probability', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      text: 'Hello.', language: 'en', languageProbability: 0.95,
    })));
    expect(await new FasterWhisperAdapter().transcribe({
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
      language: 'auto', partial: false, signal: new AbortController().signal,
    })).toMatchObject({ languageProbability: 0.95 });
  });
  it.each([-0.1, 1.1, null, '0.95'])('rejects invalid language detection probability: %j', async languageProbability => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      text: 'Hello.', language: 'en', languageProbability,
    })));
    await expect(new FasterWhisperAdapter().transcribe({
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
      language: 'auto', partial: false, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
  });
    it.each(['timeout', 'abort'])('bounds stalled Piper body reads after headers: %s', async mode => {
      jest.useFakeTimers();
      const controller = new AbortController();
      let cancelled = false;
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
        cancel() { cancelled = true; },
      }), { headers: { 'x-audio-encoding': 'pcm_s16le', 'x-audio-sample-rate': '16000' } }));
      try {
        const output = (async () => {
          for await (const _chunk of new PiperAdapter().synthesize({
            text: 'Hello.', language: 'en', voice: 'en_US-amy-medium', rate: 1, signal: controller.signal,
          })) { /* No chunk should arrive from this stalled provider. */ }
        })().catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(1);
        if (mode === 'abort') controller.abort();
        else await jest.advanceTimersByTimeAsync(12_000);
        expect(await output).toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
        expect(cancelled).toBe(true);
      } finally { jest.useRealTimers(); }
    });

  it('rejects invalid VAD frame sizes and validates the VAD response', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      speech: true,
      probability: 0.91,
    }), { headers: { 'Content-Type': 'application/json' } }));
    const adapter = new SileroVadAdapter();

    await expect(adapter.detect({
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(639) },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
    await expect(adapter.detect({
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
      streamId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
      signal: new AbortController().signal,
    })).resolves.toEqual({ speech: true, probability: 0.91 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
      streamId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
    });
  });

    it.each([
      { reliable: false, reason: 'low_log_probability', avgLogProbability: -1.2, noSpeechProbability: 0.1 },
      { reliable: true, reason: 'accepted', avgLogProbability: -0.2, noSpeechProbability: 0.1,
        audioRms: 0.15, audioPeak: 0.9, clippedFraction: 0 },
    ])('preserves actual STT text and validated recognition quality', async recognitionQuality => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        text: 'Open mic heart.', language: 'en', recognitionQuality,
      })));
      await expect(new FasterWhisperAdapter().transcribe({
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
        language: 'en', partial: false, signal: new AbortController().signal,
      })).resolves.toMatchObject({ text: 'Open mic heart.', recognitionQuality });
    });

    it.each([
      { reliable: true, reason: 'low_log_probability' },
      { reliable: false, reason: 'accepted' },
      { reliable: true, reason: 'accepted', noSpeechProbability: 2 },
      { reliable: true, reason: 'accepted', avgLogProbability: 'bad' },
      { reliable: true, reason: 'accepted', audioRms: -0.1 },
      { reliable: true, reason: 'accepted', audioPeak: 'bad' },
      { reliable: true, reason: 'accepted', clippedFraction: 1.1 },
      { reliable: true, reason: 'accepted', audioRms: null },
    ])('rejects inconsistent or malformed recognition quality', async recognitionQuality => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        text: 'Open my cart.', language: 'en', recognitionQuality,
      })));
      await expect(new FasterWhisperAdapter().transcribe({
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
        language: 'en', partial: false, signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
    });

    it('validates new VAD service timing fields instead of logging malformed values', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        frames: [{ speech: false, probability: 0 }], processingMs: -1,
      })));
      await expect(new SileroVadAdapter().detectBatch({
        streamId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
    });

  it.each([
    { partial: true, deadline: 12_000 },
    { partial: false, deadline: 45_000 },
  ])('bounds STT requests with the correct deadline: $partial', async ({ partial, deadline }) => {
    jest.useFakeTimers();
    try {
      jest.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
      const request = new FasterWhisperAdapter().transcribe({
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
        language: 'en', partial, signal: new AbortController().signal,
      });

      let settled = false;
      const result = request.then(
        () => { settled = true; return 'unexpected success'; },
        (error: unknown) => { settled = true; return error; },
      );
      await jest.advanceTimersByTimeAsync(deadline - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('batches ordered 20 ms VAD frames into one request and rejects missing decisions', async () => {
    const decisions = Array.from({ length: 5 }, (_, i) => ({ speech: i < 3, probability: i / 5 }));
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...decisions[4], frames: decisions,
    })));
    const adapter = new SileroVadAdapter();
    const input = {
      streamId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
      audio: { encoding: 'pcm_s16le' as const, sampleRate: 16000 as const, channels: 1 as const, data: Buffer.alloc(3200) },
      signal: new AbortController().signal,
    };
    await expect(adapter.detectBatch(input)).resolves.toEqual(decisions);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response(JSON.stringify({ frames: decisions.slice(1) })));
    await expect(adapter.detectBatch(input)).rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
  });

  it('keeps the final STT deadline active while reading a stalled response body', async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        },
      })));
      const result = new FasterWhisperAdapter().transcribe({
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
        language: 'en', partial: false, signal: new AbortController().signal,
      }).catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(45_000);
      expect(await result).toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([-1, 'slow'])('rejects malformed STT processing timings: %s', async processingMs => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      text: 'Hello.', language: 'en', processingMs,
    })));
    await expect(new FasterWhisperAdapter().transcribe({
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
      language: 'en', partial: false, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'VOICE_PROVIDER_INVALID' });
  });

  it.each([
    { status: 422, body: '{"detail":"invalid audio"}', code: 'VOICE_PROVIDER_INVALID' },
    { status: 503, body: '{"detail":"busy"}', code: 'VOICE_ENGINE_UNAVAILABLE' },
    { status: 200, body: 'not-json', code: 'VOICE_PROVIDER_INVALID' },
    { status: 200, body: '{"frames":[{"speech":true,"probability":2}]}', code: 'VOICE_PROVIDER_INVALID' },
  ])('reports VAD status/validation errors safely: $status $code', async ({ status, body, code }) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status }));
    await expect(new SileroVadAdapter().detectBatch({
      streamId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(640) },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code });
  });

  it('classifies unreachable VAD separately from invalid audio', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(new SileroVadAdapter().detectBatch({
      streamId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(3200) },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'VOICE_ENGINE_UNAVAILABLE' });
  });

  it('bounds VAD concurrency and queues ordered batches instead of flooding the model', async () => {
    jest.useFakeTimers();
    try {
      let active = 0;
      let maxActive = 0;
      const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        active++;
        maxActive = Math.max(maxActive, active);
        expect(String(_url)).toMatch(/\/predict$/);
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as { audio: string; encoding: string; sampleRate: number; channels: number };
        expect(body).toMatchObject({ encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 });
        expect(Buffer.from(body.audio, 'base64')).toEqual(Buffer.alloc(3200, 7));
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return new Response(JSON.stringify({ frames: Array.from({ length: 5 }, () => ({ speech: false, probability: 0 })) }));
      });
      const adapter = new SileroVadAdapter();
      const results = Promise.all(Array.from({ length: 16 }, () => adapter.detectBatch({
        streamId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(3200, 7) },
        signal: new AbortController().signal,
      })));
      await jest.advanceTimersByTimeAsync(100);
      await results;
      expect(fetch).toHaveBeenCalledTimes(16);
      expect(maxActive).toBe(2);
    } finally { jest.useRealTimers(); }
  });

  it.each(['headers', 'body'])('times out VAD through the entire response, including %s', async (phase) => {
    jest.useFakeTimers();
    try {
      jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (phase === 'headers') return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        return new Response(new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
          },
        }));
      });
      const result = new SileroVadAdapter().detectBatch({
        streamId: '4d18e2e4-e233-415e-ad10-d67ee2edb960',
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: Buffer.alloc(3200) },
        signal: new AbortController().signal,
      }).catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(500);
      expect(await result).toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
    } finally { jest.useRealTimers(); }
  });
  it('streams Piper PCM, aligns samples, and reports supported languages honestly', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.enqueue(Uint8Array.from([4]));
        controller.close();
      },
    });
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, {
      headers: { 'x-audio-encoding': 'pcm_s16le', 'x-audio-sample-rate': '16000' },
    }));
    const adapter = new PiperAdapter();
    const request = {
      text: 'Hello.',
      language: 'en' as const,
      voice: 'en_US-amy-medium',
      rate: 1,
      signal: new AbortController().signal,
    };
    const chunks: Buffer[] = [];
    for await (const chunk of adapter.synthesize(request)) chunks.push(chunk.data);

    expect(adapter.supports('te')).toBe(false);
    expect(adapter.supportsVoice('en', 'en_US-amy-medium')).toBe(true);
    expect(adapter.supportsVoice('te', 'te-IN-voice')).toBe(false);
    expect(adapter.voices('en')).toEqual(expect.arrayContaining([
      expect.objectContaining({ gender: 'female' }),
      expect.objectContaining({ gender: 'male' }),
    ]));
    expect(adapter.voices('te')).toEqual([]);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('enforces bounded, fair engine concurrency and releases permits after use', async () => {
    const semaphore = new Semaphore(1, 1);
    const releaseFirst = await semaphore.acquire();
    let thirdAcquired = false;
    const second = semaphore.acquire().then((release) => {
      thirdAcquired = true;
      return release;
    });

    await Promise.resolve();
    expect(thirdAcquired).toBe(false);
    releaseFirst();
    const releaseSecond = await second;
    expect(thirdAcquired).toBe(true);
    releaseSecond();
    const releaseThird = await semaphore.acquire();
    expect(releaseThird).toEqual(expect.any(Function));
    releaseThird();
  });

  it('rejects an already-aborted engine wait', async () => {
    const semaphore = new Semaphore(1, 1);
    const release = await semaphore.acquire();
    const controller = new AbortController();
    const queued = semaphore.acquire(controller.signal);
    controller.abort();
    await expect(queued).rejects.toBeInstanceOf(VoiceProviderError);
    release();
  });

  it('does not run an operation cancelled while waiting for an engine slot', async () => {
    const semaphore = new Semaphore(1, 1);
    const release = await semaphore.acquire();
    const controller = new AbortController();
    const operation = jest.fn(async () => 'unexpected success');
    const queued = semaphore.run(operation, controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
    release();
    expect(operation).not.toHaveBeenCalled();
    await expect(semaphore.run(async () => 'available')).resolves.toBe('available');
  });

  it('distinguishes provider timeout from an unreachable sidecar', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    await expect(fetchWithTimeout(new URL('http://127.0.0.1:8001/transcribe'), {}, 5))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
  });
});
