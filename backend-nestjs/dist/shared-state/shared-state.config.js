"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSharedStateConfig = resolveSharedStateConfig;
const shared_state_1 = require("./shared-state");
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function resolveSharedStateConfig(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const requested = env.SHARED_STATE_DRIVER?.trim().toLowerCase();
    if (requested !== undefined && requested !== '' && requested !== 'memory' && requested !== 'redis') {
        throw new shared_state_1.SharedStateConfigError('SHARED_STATE_DRIVER must be "memory" or "redis".');
    }
    const driver = (requested || (production ? 'redis' : 'memory'));
    const keyPrefix = env.REDIS_KEY_PREFIX?.trim() || 'mczen:';
    if (!/^[A-Za-z0-9:_-]{1,40}$/.test(keyPrefix))
        throw new shared_state_1.SharedStateConfigError('REDIS_KEY_PREFIX is invalid.');
    if (driver === 'memory') {
        if (production && env.MCZEN_ALLOW_PROCESS_LOCAL_STATE !== 'true') {
            throw new shared_state_1.SharedStateConfigError('Production requires shared state: set REDIS_URL, or set MCZEN_ALLOW_PROCESS_LOCAL_STATE=true to acknowledge a single-instance deployment.');
        }
        return { driver, keyPrefix };
    }
    const url = env.REDIS_URL?.trim();
    if (!url)
        throw new shared_state_1.SharedStateConfigError('REDIS_URL is required when the Redis shared-state driver is selected.');
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new shared_state_1.SharedStateConfigError('REDIS_URL is not a valid URL.');
    }
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:')
        throw new shared_state_1.SharedStateConfigError('REDIS_URL must use redis:// or rediss://.');
    if (production && parsed.protocol === 'redis:' && !LOOPBACK.has(parsed.hostname)) {
        throw new shared_state_1.SharedStateConfigError('Production Redis on a non-loopback host must use rediss:// (TLS).');
    }
    return { driver, redisUrl: url, keyPrefix };
}
//# sourceMappingURL=shared-state.config.js.map