import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { SharedStateUnavailableError, type SharedState, type SharedStateHealth } from './shared-state';

// Redis TIME is used inside scripts so slot expiry never depends on instance clock skew.
const NOW_MS = "local t = redis.call('TIME') local now = t[1] * 1000 + math.floor(t[2] / 1000)";

const HIT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return c`;

const ACQUIRE = `${NOW_MS}
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZSCORE', KEYS[1], ARGV[2]) == false and redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1`;

const RENEW = `${NOW_MS}
if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`;

const COUNT = `${NOW_MS}
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
return redis.call('ZCARD', KEYS[1])`;

export interface RedisSharedStateOptions {
  url: string;
  keyPrefix: string;
  commandTimeoutMs?: number;
}

/** Redis-backed shared state. Requires Redis >= 6.2 (GETDEL). Every failure surfaces as SharedStateUnavailableError. */
export class RedisSharedState implements SharedState {
  readonly driver = 'redis' as const;
  private readonly logger = new Logger(RedisSharedState.name);
  private readonly client: Redis;
  private lastErrorLoggedAt = 0;

  constructor(private readonly options: RedisSharedStateOptions, client?: Redis) {
    this.client = client ?? new Redis(options.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      commandTimeout: options.commandTimeoutMs ?? 1_500,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    });
    // Connection errors are reported without the URL (it can embed credentials).
    this.client.on('error', () => this.logFailure('connection error'));
  }

  async onModuleInit(): Promise<void> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      await this.client.ping();
    } catch {
      throw new SharedStateUnavailableError('Redis is configured but unreachable; refusing to start without shared state.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  async put(key: string, value: string, ttlMs: number): Promise<void> {
    await this.run(() => this.client.set(this.k(key), value, 'PX', ttlMs));
  }

  get(key: string): Promise<string | null> {
    return this.run(() => this.client.get(this.k(key)));
  }

  take(key: string): Promise<string | null> {
    return this.run(() => this.client.getdel(this.k(key)));
  }

  async del(key: string): Promise<void> {
    await this.run(() => this.client.del(this.k(key)));
  }

  async hit(key: string, windowMs: number): Promise<number> {
    return Number(await this.run(() => this.client.eval(HIT, 1, this.k(`h:${key}`), windowMs)));
  }

  async acquireSlot(scope: string, member: string, limit: number, ttlMs: number): Promise<boolean> {
    return Number(await this.run(() => this.client.eval(ACQUIRE, 1, this.k(`s:${scope}`), limit, member, ttlMs))) === 1;
  }

  async renewSlot(scope: string, member: string, ttlMs: number): Promise<void> {
    await this.run(() => this.client.eval(RENEW, 1, this.k(`s:${scope}`), member, ttlMs));
  }

  async releaseSlot(scope: string, member: string): Promise<void> {
    await this.run(() => this.client.zrem(this.k(`s:${scope}`), member));
  }

  async countSlots(scope: string): Promise<number> {
    return Number(await this.run(() => this.client.eval(COUNT, 1, this.k(`s:${scope}`))));
  }

  async health(): Promise<SharedStateHealth> {
    const started = Date.now();
    try {
      await this.client.ping();
      return { ok: true, driver: 'redis', latencyMs: Date.now() - started };
    } catch {
      return { ok: false, driver: 'redis' };
    }
  }

  private k(key: string): string { return `${this.options.keyPrefix}${key}`; }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      this.logFailure('command failed');
      throw new SharedStateUnavailableError();
    }
  }

  private logFailure(reason: string): void {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt < 10_000) return;
    this.lastErrorLoggedAt = now;
    this.logger.error(`Shared state (Redis) ${reason}.`);
  }
}
