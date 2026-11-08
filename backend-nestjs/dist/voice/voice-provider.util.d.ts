export declare class VoiceProviderError extends Error {
    readonly code: 'VOICE_ENGINE_UNAVAILABLE' | 'VOICE_PROVIDER_TIMEOUT' | 'VOICE_PROVIDER_INVALID';
    constructor(code: 'VOICE_ENGINE_UNAVAILABLE' | 'VOICE_PROVIDER_TIMEOUT' | 'VOICE_PROVIDER_INVALID');
}
export declare function readLoopbackUrl(name: string, defaultValue: string): URL;
export declare function fetchWithTimeout(input: URL, init: RequestInit, timeoutMs: number): Promise<Response>;
export declare function fetchWithTimeout<T>(input: URL, init: RequestInit, timeoutMs: number, readResponse: (response: Response) => Promise<T>): Promise<T>;
export declare class Semaphore {
    private readonly maxActive;
    private readonly maxQueued;
    private active;
    private readonly waiters;
    constructor(maxActive: number, maxQueued: number);
    run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    acquire(signal?: AbortSignal): Promise<() => void>;
    private createRelease;
}
