type Env = Record<string, string | undefined>;
export interface SharedStateConfig {
    driver: 'memory' | 'redis';
    redisUrl?: string;
    keyPrefix: string;
}
export declare function resolveSharedStateConfig(env?: Env): SharedStateConfig;
export {};
