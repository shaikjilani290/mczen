import { DhvaaniAdapter } from './dhvaani.adapter';
import { PiperAdapter } from './piper.adapter';
import { CompositeTtsAdapter } from './composite-tts.adapter';
import type { TtsAudioChunk, TtsRequest } from './tts.port';
import { VoiceProviderError } from '../voice-provider.util';

const audio: TtsAudioChunk = {
  encoding: 'pcm_s16le',
  sampleRate: 16000,
  data: Buffer.from([1, 0, 2, 0]),
};

async function collect(iterable: AsyncIterable<TtsAudioChunk>): Promise<TtsAudioChunk[]> {
  const chunks: TtsAudioChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

describe('CompositeTtsAdapter', () => {
  let adapter: CompositeTtsAdapter;
  let dhvaani: DhvaaniAdapter;
  let piper: PiperAdapter;

  beforeEach(() => {
    dhvaani = new DhvaaniAdapter();
    piper = new PiperAdapter();
    adapter = new CompositeTtsAdapter(dhvaani, piper);
  });

  it('falls back to Dhvaani when the configured Piper voice is unavailable', async () => {
    jest.spyOn(piper, 'synthesize').mockImplementation(async function* () {
      throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
    });
    const dhvaaniSynthesize = jest.spyOn(dhvaani, 'synthesize').mockImplementation(async function* (request) {
      expect(request.text).toBe('Explain ZENAGE from the product details.');
      expect(request.voice).toBe('my_voice');
      yield audio;
    });
    const request: TtsRequest = {
      text: 'Explain ZENAGE from the product details.',
      language: 'en',
      voice: 'en_US-amy-medium',
      rate: 1,
      signal: new AbortController().signal,
    };

    await expect(collect(adapter.synthesize(request))).resolves.toEqual([audio]);
    expect(dhvaaniSynthesize).toHaveBeenCalledTimes(1);
  });

  it('does not retry through another provider after audio has already been emitted', async () => {
    jest.spyOn(piper, 'synthesize').mockImplementation(async function* () {
      yield audio;
      throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
    });
    const dhvaaniSynthesize = jest.spyOn(dhvaani, 'synthesize');
    const request: TtsRequest = {
      text: 'Explain ZENAGE.',
      language: 'en',
      voice: 'en_US-amy-medium',
      rate: 1,
      signal: new AbortController().signal,
    };

    await expect(collect(adapter.synthesize(request))).rejects.toMatchObject({
      code: 'VOICE_ENGINE_UNAVAILABLE',
    });
    expect(dhvaaniSynthesize).not.toHaveBeenCalled();
  });
});
