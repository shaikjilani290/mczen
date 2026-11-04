"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisSharedState = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const common_1 = require("@nestjs/common");
const shared_state_1 = require("./shared-state");
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
class RedisSharedState {
    options;
    driver = 'redis';
    logger = new common_1.Logger(RedisSharedState.name);
    client;
    lastErrorLoggedAt = 0;
    constructor(options, client) {
        this.options = options;
        this.client = client ?? new ioredis_1.default(options.url, {
            lazyConnect: true,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
            connectTimeout: 3_000,
            commandTimeout: options.commandTimeoutMs ?? 1_500,
            retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
        });
        this.client.on('error', () => this.logFailure('connection error'));
    }
    async onModuleInit() {
        try {
            if (this.client.status === 'wait')
                await this.client.connect();
            await this.client.ping();
        }
        catch {
            throw new shared_state_1.SharedStateUnavailableError('Redis is configured but unreachable; refusing to start without shared state.');
        }
    }
    async onModuleDestroy() {
        await this.client.quit().catch(() => this.client.disconnect());
    }
    async put(key, value, ttlMs) {
        await this.run(() => this.client.set(this.k(key), value, 'PX', ttlMs));
    }
    get(key) {
        return this.run(() => this.client.get(this.k(key)));
    }
    take(key) {
        return this.run(() => this.client.getdel(this.k(key)));
    }
    async del(key) {
        await this.run(() => this.client.del(this.k(key)));
    }
    async hit(key, windowMs) {
        return Number(await this.run(() => this.client.eval(HIT, 1, this.k(`h:${key}`), windowMs)));
    }
    async acquireSlot(scope, member, limit, ttlMs) {
        return Number(await this.run(() => this.client.eval(ACQUIRE, 1, this.k(`s:${scope}`), limit, member, ttlMs))) === 1;
    }
    async renewSlot(scope, member, ttlMs) {
        await this.run(() => this.client.eval(RENEW, 1, this.k(`s:${scope}`), member, ttlMs));
    }
    async releaseSlot(scope, member) {
        await this.run(() => this.client.zrem(this.k(`s:${scope}`), member));
    }
    async countSlots(scope) {
        return Number(await this.run(() => this.client.eval(COUNT, 1, this.k(`s:${scope}`))));
    }
    async health() {
        const started = Date.now();
        try {
            await this.client.ping();
            return { ok: true, driver: 'redis', latencyMs: Date.now() - started };
        }
        catch {
            return { ok: false, driver: 'redis' };
        }
    }
    k(key) { return `${this.options.keyPrefix}${key}`; }
    async run(operation) {
        try {
            return await operation();
        }
        catch {
            this.logFailure('command failed');
            throw new shared_state_1.SharedStateUnavailableError();
        }
    }
    logFailure(reason) {
        const now = Date.now();
        if (now - this.lastErrorLoggedAt < 10_000)
            return;
        this.lastErrorLoggedAt = now;
        this.logger.error(`Shared state (Redis) ${reason}.`);
    }
}
exports.RedisSharedState = RedisSharedState;
//# sourceMappingURL=redis-shared-state.js.map