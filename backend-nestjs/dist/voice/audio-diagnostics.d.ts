export declare function audioDiagnosticsEnabled(): boolean;
export declare class PcmDiagnostics {
    samples: number;
    packets: number;
    missingPackets: number;
    reorderedPackets: number;
    duplicatePackets: number;
    private prior?;
    private epoch?;
    private squares;
    private peak;
    private clipped;
    private silent;
    packet(sequence: number, epoch?: number): void;
    append(pcm: Buffer): void;
    snapshot(): {
        encoding: string;
        sampleRate: number;
        channels: number;
        audioMs: number;
        samples: number;
        rms: number;
        peak: number;
        clippingPercent: number;
        silencePercent: number;
        silenceThreshold: number;
        packets: number;
        missingPackets: number;
        reorderedPackets: number;
        duplicatePackets: number;
    };
}
