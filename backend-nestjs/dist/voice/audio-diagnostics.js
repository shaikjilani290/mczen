"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PcmDiagnostics = void 0;
exports.audioDiagnosticsEnabled = audioDiagnosticsEnabled;
function audioDiagnosticsEnabled() {
    return process.env.NODE_ENV !== 'production' && process.env.MCZEN_AUDIO_DIAGNOSTICS === 'metadata';
}
class PcmDiagnostics {
    samples = 0;
    packets = 0;
    missingPackets = 0;
    reorderedPackets = 0;
    duplicatePackets = 0;
    prior;
    epoch;
    squares = 0;
    peak = 0;
    clipped = 0;
    silent = 0;
    packet(sequence, epoch = 0) {
        if (this.epoch !== epoch) {
            this.epoch = epoch;
            this.prior = undefined;
        }
        this.packets++;
        if (this.prior !== undefined) {
            const delta = (sequence - this.prior) >>> 0;
            if (delta === 0)
                this.duplicatePackets++;
            else if (delta >= 0x80000000)
                this.reorderedPackets++;
            else if (delta > 1)
                this.missingPackets += delta - 1;
            if (delta === 0 || delta >= 0x80000000)
                return;
        }
        this.prior = sequence;
    }
    append(pcm) {
        for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
            const value = pcm.readInt16LE(offset) / 32768;
            this.samples++;
            this.squares += value * value;
            this.peak = Math.max(this.peak, Math.abs(value));
            if (Math.abs(value) >= 0.999)
                this.clipped++;
            if (Math.abs(value) < 0.01)
                this.silent++;
        }
    }
    snapshot() {
        return {
            encoding: 'pcm_s16le', sampleRate: 16000, channels: 1,
            audioMs: this.samples / 16, samples: this.samples,
            rms: this.samples ? Math.sqrt(this.squares / this.samples) : 0,
            peak: this.peak,
            clippingPercent: this.samples ? this.clipped / this.samples * 100 : 0,
            silencePercent: this.samples ? this.silent / this.samples * 100 : 0,
            silenceThreshold: 0.01,
            packets: this.packets, missingPackets: this.missingPackets,
            reorderedPackets: this.reorderedPackets, duplicatePackets: this.duplicatePackets,
        };
    }
}
exports.PcmDiagnostics = PcmDiagnostics;
//# sourceMappingURL=audio-diagnostics.js.map