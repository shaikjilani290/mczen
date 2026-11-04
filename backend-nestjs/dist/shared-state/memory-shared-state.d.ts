import { type SharedState, type SharedStateHealth } from './shared-state';
export declare class MemorySharedState implements SharedState {
    private readonly now;
    private readonly maxEntries;
    readonly driver: "memory";
    private readonly values;
    private readonly counters;
    private readonly slots;
    constructor(now?: () => number, maxEntries?: number);
    put(key: string, value: string, ttlMs: number): Promise<void>;
    get(key: string): Promise<string | null>;
    take(key: string): Promise<string | null>;
    private read;
    del(key: string): Promise<void>;
    hit(key: string, windowMs: number): Promise<number>;
    acquireSlot(scope: string, member: string, limit: number, ttlMs: number): Promise<boolean>;
    renewSlot(scope: string, member: string, ttlMs: number): Promise<void>;
    releaseSlot(scope: string, member: string): Promise<void>;
    countSlots(scope: string): Promise<number>;
    health(): Promise<SharedStateHealth>;
    private liveSlots;
    private ensureCapacity;
}
