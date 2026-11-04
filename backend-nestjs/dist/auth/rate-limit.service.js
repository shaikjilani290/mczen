"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitService = exports.RateLimitConfigError = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const auth_dto_1 = require("./auth.dto");
const token_service_1 = require("./token.service");
class RateLimitConfigError extends Error {
}
exports.RateLimitConfigError = RateLimitConfigError;
const WINDOW_MS = 60_000;
const EDGE_RATE_CHECKED = Symbol('MCZEN_EDGE_RATE_CHECKED');
const AUTH_LIMITS = { register: 5, login: 10, refresh: 30, forgot: 5, reset: 5, verify: 10 };
function setting(env, key, fallback, ceiling) {
    const raw = env[key];
    if (raw === undefined || raw === '')
        return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
        throw new RateLimitConfigError(`${key} must be an integer between 1 and ${ceiling}.`);
    return value;
}
function digest(value) { return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex'); }
function peerAddress(request) {
    return request.ip ?? request.socket.remoteAddress ?? 'unknown-peer';
}
let RateLimitService = class RateLimitService {
    buckets = new Map();
    now;
    ipLimit;
    sessionLimit;
    tenantLimit;
    maxKeys;
    nextSweep = 0;
    constructor(options = {}) {
        const env = options.env ?? process.env;
        this.now = options.now ?? Date.now;
        this.ipLimit = setting(env, 'MCZEN_RATE_IP_PER_MINUTE', 300, 300);
        this.sessionLimit = setting(env, 'MCZEN_RATE_SESSION_PER_MINUTE', 120, 120);
        this.tenantLimit = setting(env, 'MCZEN_RATE_TENANT_PER_MINUTE', 600, 600);
        this.maxKeys = setting(env, 'MCZEN_RATE_MAX_KEYS', 10_000, 10_000);
    }
    checkRequest(request, response, policy) {
        const ip = digest(peerAddress(request));
        if (!request[EDGE_RATE_CHECKED]) {
            this.consume(`ip:${ip}`, this.ipLimit, response);
        }
        if (!policy)
            return;
        this.consume(`auth:${policy}:${ip}`, AUTH_LIMITS[policy], response);
        if (policy === 'login' || policy === 'forgot') {
            const email = (0, auth_dto_1.normalizeEmail)(request.body?.email);
            if (email)
                this.consume(`mailbox:${policy}:${digest(email)}`, AUTH_LIMITS[policy], response);
        }
        if (policy === 'refresh' && (0, token_service_1.isOpaqueToken)(request.body?.refreshToken, 'mzr_')) {
            this.consume(`refresh:${digest(request.body.refreshToken)}`, AUTH_LIMITS.refresh, response);
        }
    }
    checkEdge(request, response) {
        this.consume(`ip:${digest(peerAddress(request))}`, this.ipLimit, response);
        Object.defineProperty(request, EDGE_RATE_CHECKED, { value: true });
    }
    checkContext(response, user, tenant) {
        if (user)
            this.consume(`session:${digest(user.sessionId)}`, this.sessionLimit, response);
        if (tenant)
            this.consume(`tenant:${digest(tenant.tenantId)}`, this.tenantLimit, response);
    }
    consume(key, limit, response) {
        const now = this.now();
        if (now >= this.nextSweep) {
            for (const [name, bucket] of this.buckets)
                if (bucket.expiresAt <= now)
                    this.buckets.delete(name);
            this.nextSweep = now + 5_000;
        }
        let bucket = this.buckets.get(key);
        if (!bucket) {
            if (this.buckets.size >= this.maxKeys) {
                for (const [name, candidate] of this.buckets)
                    if (candidate.expiresAt <= now)
                        this.buckets.delete(name);
                if (this.buckets.size >= this.maxKeys)
                    return this.deny(response, 60);
            }
            bucket = { times: [], expiresAt: now + WINDOW_MS };
            this.buckets.set(key, bucket);
        }
        bucket.times = bucket.times.filter((time) => time > now - WINDOW_MS);
        if (bucket.times.length >= limit)
            return this.deny(response, Math.ceil((bucket.times[0] + WINDOW_MS - now) / 1000));
        bucket.times.push(now);
        bucket.expiresAt = now + WINDOW_MS;
    }
    deny(response, retryAfter) {
        response.setHeader('Retry-After', Math.max(1, retryAfter));
        throw new common_1.HttpException({ statusCode: 429, error: 'Too Many Requests', message: 'Too many requests.' }, 429);
    }
};
exports.RateLimitService = RateLimitService;
exports.RateLimitService = RateLimitService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], RateLimitService);
//# sourceMappingURL=rate-limit.service.js.map