import Redis from 'ioredis';
import { type SharedState, type SharedStateHealth } from './shared-state';
export interface RedisSharedStateOptions {
    url: string;
    keyPrefix: string;
    commandTimeoutMs?: number;
}
export declare class RedisSharedState implements SharedState {
    private readonly options;
    readonly driver: "redis";
    private readonly logger;
    private readonly client;
    private lastErrorLoggedAt;
    constructor(options: RedisSharedStateOptions, client?: Redis);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
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
    private k;
    private run;
    private logFailure;
}
