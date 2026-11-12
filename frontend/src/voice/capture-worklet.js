function installCaptureProcessor() {
  class MczenCapture extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.diagnostics = options?.processorOptions?.audioDiagnostics === true;
      this.levels = { source: this.emptyLevels(), resampled: this.emptyLevels() };
      this.ring = new Int16Array(32000);
      this.read = 0;
      this.count = 0;
      this.credit = 4;
      this.failed = false;
      this.epoch = 0;
      this.phase = 0;
      this.sum = 0;
      this.samples = 0;
      this.port.onmessage = ({ data }) => {
        if (data.type === "reset") {
          this.read = this.count = 0;
          this.phase = this.sum = this.samples = 0;
          if (this.diagnostics) this.levels = { source: this.emptyLevels(), resampled: this.emptyLevels() };
          this.epoch = data.epoch;
          this.credit = 4;
        } else if (data.type === "credit" && data.epoch === this.epoch) {
          this.credit = Math.min(4, this.credit + (data.count ?? 1));
        }
      };
    }

    emptyLevels() {
      return { samples: 0, squares: 0, peak: 0, clipped: 0, silent: 0 };
    }

    level(stage, value) {
      const state = this.levels[stage];
      state.samples++;
      state.squares += value * value;
      state.peak = Math.max(state.peak, Math.abs(value));
      if (Math.abs(value) >= 0.999) state.clipped++;
      if (Math.abs(value) < 0.01) state.silent++;
    }

    process(inputs) {
      if (this.failed) return false;
      const input = inputs[0]?.[0];
      if (!input) return true;
      for (let i = 0; i < input.length; i++) {
        if (this.diagnostics) this.level("source", input[i]);
        this.phase += 16000;
        this.sum += input[i];
        this.samples++;
        if (this.phase < sampleRate) continue;
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.samples));
        if (this.diagnostics) this.level("resampled", value);
        this.sum = this.samples = 0;
        if (this.count === this.ring.length) {
          this.failed = true;
          this.port.postMessage({ type: "overflow", bufferedMs: this.count / 16 });
          return false;
        }
        if (this.diagnostics && this.levels.source.samples >= sampleRate) {
          const summarize = (state, rate) => ({
            samples: state.samples, audioMs: state.samples / rate * 1000, sampleRate: rate, channels: 1,
            rms: Math.sqrt(state.squares / state.samples), peak: state.peak,
            clippingPercent: state.clipped / state.samples * 100,
            silencePercent: state.silent / state.samples * 100, silenceThreshold: 0.01,
          });
          this.port.postMessage({ type: "diagnostics", epoch: this.epoch,
            source: summarize(this.levels.source, sampleRate), resampled: summarize(this.levels.resampled, 16000) });
          this.levels = { source: this.emptyLevels(), resampled: this.emptyLevels() };
        }
        this.ring[(this.read + this.count++) % this.ring.length] = Math.round(value * (value < 0 ? 32768 : 32767));
      }
      if (this.credit && this.count >= 1600) {
        const pcm = new Int16Array(1600);
        for (let i = 0; i < pcm.length; i++) pcm[i] = this.ring[(this.read + i) % this.ring.length];
        this.read = (this.read + pcm.length) % this.ring.length;
        this.count -= pcm.length;
        this.credit--;
        this.port.postMessage({
          type: "audio", pcm, epoch: this.epoch, bufferedMs: this.count / 16,
          capturedAt: currentTime + input.length / sampleRate - this.count / 16000,
        }, [pcm.buffer]);
      }
      return true;
    }
  }
  registerProcessor("mczen-capture", MczenCapture);
}

// Inline module keeps the standalone cross-origin SDK self-contained.
export const captureWorkletSource = `(${installCaptureProcessor.toString()})();`;
