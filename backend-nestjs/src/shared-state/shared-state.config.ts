import { SharedStateConfigError } from './shared-state';

type Env = Record<string, string | undefined>;

export interface SharedStateConfig {
  driver: 'memory' | 'redis';
  redisUrl?: string;
  keyPrefix: string;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Resolves which shared-state driver to use. Production never silently degrades to process-local state:
 * - production defaults to Redis and needs REDIS_URL;
 * - memory in production requires MCZEN_ALLOW_PROCESS_LOCAL_STATE=true (explicit single-instance acknowledgement).
 * Error messages name variables only; no value (including REDIS_URL, which may embed a password) is echoed.
 */
export function resolveSharedStateConfig(env: Env = process.env): SharedStateConfig {
  const production = env.NODE_ENV === 'production';
  const requested = env.SHARED_STATE_DRIVER?.trim().toLowerCase();
  if (requested !== undefined && requested !== '' && requested !== 'memory' && requested !== 'redis') {
    throw new SharedStateConfigError('SHARED_STATE_DRIVER must be "memory" or "redis".');
  }
  const driver = (requested || (production ? 'redis' : 'memory')) as 'memory' | 'redis';
  const keyPrefix = env.REDIS_KEY_PREFIX?.trim() || 'mczen:';
  if (!/^[A-Za-z0-9:_-]{1,40}$/.test(keyPrefix)) throw new SharedStateConfigError('REDIS_KEY_PREFIX is invalid.');

  if (driver === 'memory') {
    if (production && env.MCZEN_ALLOW_PROCESS_LOCAL_STATE !== 'true') {
      throw new SharedStateConfigError(
        'Production requires shared state: set REDIS_URL, or set MCZEN_ALLOW_PROCESS_LOCAL_STATE=true to acknowledge a single-instance deployment.',
      );
    }
    return { driver, keyPrefix };
  }

  const url = env.REDIS_URL?.trim();
  if (!url) throw new SharedStateConfigError('REDIS_URL is required when the Redis shared-state driver is selected.');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new SharedStateConfigError('REDIS_URL is not a valid URL.'); }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') throw new SharedStateConfigError('REDIS_URL must use redis:// or rediss://.');
  if (production && parsed.protocol === 'redis:' && !LOOPBACK.has(parsed.hostname)) {
    throw new SharedStateConfigError('Production Redis on a non-loopback host must use rediss:// (TLS).');
  }
  return { driver, redisUrl: url, keyPrefix };
}
