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

  it('distinguishes provider timeout from an unreachable sidecar', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    await expect(fetchWithTimeout(new URL('http://127.0.0.1:8001/transcribe'), {}, 5))
      .rejects.toMatchObject({ code: 'VOICE_PROVIDER_TIMEOUT' });
  });
});
