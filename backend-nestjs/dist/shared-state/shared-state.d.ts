export declare const SHARED_STATE: unique symbol;
export interface SharedStateHealth {
    ok: boolean;
    driver: 'memory' | 'redis';
    latencyMs?: number;
}
export interface SharedState {
    readonly driver: 'memory' | 'redis';
    put(key: string, value: string, ttlMs: number): Promise<void>;
    get(key: string): Promise<string | null>;
    take(key: string): Promise<string | null>;
    del(key: string): Promise<void>;
    hit(key: string, windowMs: number): Promise<number>;
    acquireSlot(scope: string, member: string, limit: number, ttlMs: number): Promise<boolean>;
    renewSlot(scope: string, member: string, ttlMs: number): Promise<void>;
    releaseSlot(scope: string, member: string): Promise<void>;
    countSlots(scope: string): Promise<number>;
    health(): Promise<SharedStateHealth>;
}
export declare class SharedStateUnavailableError extends Error {
    constructor(message?: string);
}
export declare class SharedStateConfigError extends Error {
    constructor(message: string);
}
