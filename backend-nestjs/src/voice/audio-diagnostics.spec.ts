import { audioDiagnosticsEnabled, PcmDiagnostics } from './audio-diagnostics';

describe('development audio metadata', () => {
  it('is opt-in and forbidden in production', () => {
    const previous = { mode: process.env.NODE_ENV, flag: process.env.MCZEN_AUDIO_DIAGNOSTICS };
    try {
      delete process.env.MCZEN_AUDIO_DIAGNOSTICS;
      expect(audioDiagnosticsEnabled()).toBe(false);
      process.env.MCZEN_AUDIO_DIAGNOSTICS = 'metadata';
      process.env.NODE_ENV = 'development';
      expect(audioDiagnosticsEnabled()).toBe(true);
      process.env.NODE_ENV = 'production';
      expect(audioDiagnosticsEnabled()).toBe(false);
    } finally {
      if (previous.mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.mode;
      if (previous.flag === undefined) delete process.env.MCZEN_AUDIO_DIAGNOSTICS;
      else process.env.MCZEN_AUDIO_DIAGNOSTICS = previous.flag;
    }
  });

  it('measures PCM without retaining it and counts sequence anomalies across wrap', () => {
    const diagnostics = new PcmDiagnostics();
    const pcm = Buffer.alloc(8);
    [0, -32768, 32767, 0].forEach((value, index) => pcm.writeInt16LE(value, index * 2));
    diagnostics.append(pcm);
    for (const sequence of [0xfffffffe, 0xffffffff, 0, 0, 0xffffffff, 3]) diagnostics.packet(sequence);
    expect(diagnostics.snapshot()).toMatchObject({
      samples: 4, peak: 1, silencePercent: 50, clippingPercent: 50,
      packets: 6, missingPackets: 2, reorderedPackets: 1, duplicatePackets: 1,
    });
    expect(diagnostics.snapshot().rms).toBeCloseTo(Math.sqrt((1 + (32767 / 32768) ** 2) / 4));
    expect(new PcmDiagnostics().snapshot().rms).toBe(0);
    diagnostics.packet(0, 1);
    diagnostics.packet(1, 1);
    expect(diagnostics.snapshot()).toMatchObject({
      packets: 8, missingPackets: 2, reorderedPackets: 1, duplicatePackets: 1,
    });
  });
});
