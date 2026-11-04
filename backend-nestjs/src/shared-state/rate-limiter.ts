import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { SharedStateUnavailableError, type SharedState } from './shared-state';

export function tooManyRequests(): HttpException {
  return new HttpException({ statusCode: 429, error: 'Too Many Requests', message: 'Too many requests.' }, 429);
}

/**
 * Fixed-window rate limiter on top of SharedState so limits hold across backend instances.
 * Fails closed: if the store is unavailable the request is rejected with 503, never allowed.
 */
export class SharedRateLimiter {
  constructor(private readonly store: SharedState, private readonly windowMs = 60_000) {}

  async hit(key: string, limit: number): Promise<void> {
    let count: number;
    try {
      count = await this.store.hit(`rl:${key}`, this.windowMs);
    } catch (error) {
      if (error instanceof SharedStateUnavailableError) throw new ServiceUnavailableException('Service is temporarily unavailable.');
      throw error;
    }
    if (count > limit) throw tooManyRequests();
  }
}
