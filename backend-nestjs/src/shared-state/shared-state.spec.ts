import { MemorySharedState } from './memory-shared-state';
import { SharedStateConfigError, SharedStateUnavailableError, type SharedState } from './shared-state';
import { resolveSharedStateConfig } from './shared-state.config';

/** Contract suite reused by the real-Redis test (redis-shared-state.real.spec.ts). */
export function runSharedStateContract(name: string, create: () => SharedState | Promise<SharedState>) {
  describe(`SharedState contract: ${name}`, () => {
    let s: SharedState;
    const id = () => `t${Date.now()}${Math.random().toString(36).slice(2)}`;
    beforeEach(async () => { s = await create(); });

    it('put/get/del round-trips', async () => {
      const k = id();
      await s.put(k, 'v', 5_000);
      expect(await s.get(k)).toBe('v');
      await s.del(k);
      expect(await s.get(k)).toBeNull();
    });

    it('take is atomic: exactly one of many concurrent callers wins', async () => {
      const k = id();
      await s.put(k, 'v', 5_000);
      const results = await Promise.all(Array.from({ length: 20 }, () => s.take(k)));
      expect(results.filter((r) => r === 'v')).toHaveLength(1);
    });

    it('expires records', async () => {
      const k = id();
      await s.put(k, 'v', 50);
      await new Promise((r) => setTimeout(r, 120));
      expect(await s.get(k)).toBeNull();
    });

    it('hit counts within a window and resets after it', async () => {
      const k = id();
      expect(await s.hit(k, 80)).toBe(1);
      expect(await s.hit(k, 80)).toBe(2);
      await new Promise((r) => setTimeout(r, 140));
      expect(await s.hit(k, 80)).toBe(1);
    });

    it('slots enforce a limit, are idempotent per member, release and expire', async () => {
      const scope = id();
      expect(await s.acquireSlot(scope, 'a', 2, 5_000)).toBe(true);
      expect(await s.acquireSlot(scope, 'a', 2, 5_000)).toBe(true);
      expect(await s.acquireSlot(scope, 'b', 2, 5_000)).toBe(true);
      expect(await s.acquireSlot(scope, 'c', 2, 5_000)).toBe(false);
      expect(await s.countSlots(scope)).toBe(2);
      await s.releaseSlot(scope, 'a');
      expect(await s.acquireSlot(scope, 'c', 2, 60)).toBe(true);
      await new Promise((r) => setTimeout(r, 140));
      expect(await s.countSlots(scope)).toBe(1);
      await s.renewSlot(scope, 'missing', 5_000);
      expect(await s.countSlots(scope)).toBe(1);
    });

    it('reports healthy', async () => {
      expect((await s.health()).ok).toBe(true);
    });
  });
}

runSharedStateContract('memory', () => new MemorySharedState());

describe('MemorySharedState', () => {
  it('fails closed at capacity instead of growing unbounded', async () => {
    const s = new MemorySharedState(() => 0, 2);
    await s.put('a', '1', 1_000);
    await s.put('b', '1', 1_000);
    await expect(s.put('c', '1', 1_000)).rejects.toThrow(SharedStateUnavailableError);
  });
});

describe('resolveSharedStateConfig', () => {
  it('defaults to memory outside production', () => {
    expect(resolveSharedStateConfig({}).driver).toBe('memory');
  });

  it('requires Redis in production unless single-instance is acknowledged', () => {
    expect(() => resolveSharedStateConfig({ NODE_ENV: 'production' })).toThrow(SharedStateConfigError);
    expect(resolveSharedStateConfig({ NODE_ENV: 'production', MCZEN_ALLOW_PROCESS_LOCAL_STATE: 'true', SHARED_STATE_DRIVER: 'memory' }).driver).toBe('memory');
    expect(resolveSharedStateConfig({ NODE_ENV: 'production', REDIS_URL: 'rediss://cache.internal:6380' }).driver).toBe('redis');
  });

  it('never echoes the Redis URL or password in errors', () => {
    const secret = 'hunter2-password';
    for (const url of [`http://:${secret}@host`, `redis://:${secret}@cache.example:6379`, `not a url ${secret}`]) {
      try {
        resolveSharedStateConfig({ NODE_ENV: 'production', REDIS_URL: url });
        if (!url.startsWith('redis://')) throw new Error('expected a config error');
      } catch (error) {
        expect((error as Error).message).not.toContain(secret);
      }
    }
  });

  it('rejects plaintext Redis on a non-loopback host in production', () => {
    expect(() => resolveSharedStateConfig({ NODE_ENV: 'production', REDIS_URL: 'redis://cache.example:6379' })).toThrow(SharedStateConfigError);
    expect(resolveSharedStateConfig({ NODE_ENV: 'production', REDIS_URL: 'redis://127.0.0.1:6379' }).driver).toBe('redis');
  });

  it('rejects unknown drivers and bad prefixes', () => {
    expect(() => resolveSharedStateConfig({ SHARED_STATE_DRIVER: 'etcd' })).toThrow(SharedStateConfigError);
    expect(() => resolveSharedStateConfig({ REDIS_KEY_PREFIX: 'bad prefix!' })).toThrow(SharedStateConfigError);
  });
});
