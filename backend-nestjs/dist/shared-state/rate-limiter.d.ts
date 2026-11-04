import { HttpException } from '@nestjs/common';
import { type SharedState } from './shared-state';
export declare function tooManyRequests(): HttpException;
export declare class SharedRateLimiter {
    private readonly store;
    private readonly windowMs;
    constructor(store: SharedState, windowMs?: number);
    hit(key: string, limit: number): Promise<void>;
}
