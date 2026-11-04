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
exports.TokenService = exports.TokenConfigError = exports.JWT_AUDIENCE = exports.JWT_ISSUER = void 0;
exports.newRefreshToken = newRefreshToken;
exports.hashOpaqueToken = hashOpaqueToken;
exports.newPendingToken = newPendingToken;
exports.isOpaqueToken = isOpaqueToken;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
exports.JWT_ISSUER = 'mczen-ai';
exports.JWT_AUDIENCE = 'mczen-dashboard';
const MIN_SECRET_LENGTH = 32;
class TokenConfigError extends Error {
}
exports.TokenConfigError = TokenConfigError;
function base64urlEncode(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
function base64urlDecode(input) {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (padded.length % 4)) % 4;
    return Buffer.from(padded + '='.repeat(padLength), 'base64');
}
function ttl(env, name, fallback, min, max) {
    const raw = env[name];
    if (raw === undefined || raw === '')
        return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new TokenConfigError(`${name} must be an integer between ${min} and ${max}.`);
    }
    return value;
}
function canonicalPart(value) {
    return /^[A-Za-z0-9_-]+$/.test(value) && base64urlDecode(value).toString('base64url') === value;
}
let TokenService = class TokenService {
    keys;
    currentKid;
    accessTtlMs;
    refreshTtlSec;
    nowSource;
    constructor(options = {}) {
        const env = options.env ?? process.env;
        const isProduction = env.NODE_ENV === 'production';
        const secret = env.JWT_SECRET;
        if (!secret || Buffer.byteLength(secret, 'utf8') < MIN_SECRET_LENGTH) {
            if (isProduction) {
                throw new TokenConfigError('JWT_SECRET is required in production and must be at least 32 bytes.');
            }
            if (secret && Buffer.byteLength(secret, 'utf8') < MIN_SECRET_LENGTH) {
                throw new TokenConfigError('JWT_SECRET must be at least 32 bytes when provided.');
            }
        }
        if (secret === 'replace-with-32-bytes-of-random-secret') {
            throw new TokenConfigError('Replace the example JWT_SECRET with a randomly generated signing key.');
        }
        const effectiveSecret = secret ||
            base64urlEncode((0, node_crypto_1.randomBytes)(MIN_SECRET_LENGTH));
        this.currentKid = env.JWT_CURRENT_KID ?? 'v1';
        const previousSecret = env.JWT_PREVIOUS_SECRET || undefined;
        const previousKid = env.JWT_PREVIOUS_KID ?? 'v0';
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(this.currentKid) || !/^[A-Za-z0-9_-]{1,64}$/.test(previousKid)) {
            throw new TokenConfigError('JWT key identifiers must be 1–64 URL-safe characters.');
        }
        if (previousSecret && (previousSecret === 'replace-with-32-bytes-of-random-secret' || Buffer.byteLength(previousSecret, 'utf8') < MIN_SECRET_LENGTH || previousKid === this.currentKid)) {
            throw new TokenConfigError('The previous JWT key must be at least 32 bytes and have a distinct key identifier.');
        }
        this.keys = [
            { kid: this.currentKid, secret: effectiveSecret },
            ...(previousSecret && previousKid !== this.currentKid
                ? [{ kid: previousKid, secret: previousSecret }]
                : []),
        ];
        this.accessTtlMs = ttl(env, 'AUTH_ACCESS_TOKEN_TTL_SECONDS', 900, 600, 900) * 1000;
        this.refreshTtlSec = ttl(env, 'AUTH_REFRESH_TOKEN_TTL_SECONDS', 2_592_000, 1, 2_592_000);
        this.nowSource = () => Date.now();
    }
    get accessTtlSeconds() {
        return Math.round(this.accessTtlMs / 1000);
    }
    get refreshTtlSeconds() {
        return this.refreshTtlSec;
    }
    sign(payload, now = this.nowSource()) {
        if (!(0, uuid_1.isUuidv7)(payload.userId) || !(0, uuid_1.isUuidv7)(payload.sessionId) || (payload.tenantId !== null && !(0, uuid_1.isUuidv7)(payload.tenantId))) {
            throw new Error('Cannot sign an invalid authentication identity.');
        }
        const iat = Math.floor(now / 1000);
        const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: this.currentKid }));
        const body = base64urlEncode(JSON.stringify({
            sub: payload.userId,
            sid: payload.sessionId,
            tid: payload.tenantId,
            iss: exports.JWT_ISSUER,
            aud: exports.JWT_AUDIENCE,
            iat,
            nbf: iat,
            exp: iat + this.accessTtlSeconds,
        }));
        return `${header}.${body}.${this.hmac(header, body, this.currentKid).toString('base64url')}`;
    }
    verify(token, now = this.nowSource()) {
        if (typeof token !== 'string' || token.length > 2048)
            return { ok: false, reason: 'malformed' };
        const parts = token.split('.');
        if (parts.length !== 3 || !parts.every(canonicalPart))
            return { ok: false, reason: 'malformed' };
        const [headerPart, bodyPart, signaturePart] = parts;
        let header;
        let claims;
        try {
            header = JSON.parse(base64urlDecode(headerPart).toString('utf8'));
            claims = JSON.parse(base64urlDecode(bodyPart).toString('utf8'));
            if (!header || typeof header !== 'object' || Array.isArray(header) || !claims || typeof claims !== 'object' || Array.isArray(claims)) {
                return { ok: false, reason: 'malformed' };
            }
        }
        catch {
            return { ok: false, reason: 'malformed' };
        }
        if (header.alg !== 'HS256')
            return { ok: false, reason: 'bad_algorithm' };
        if (header.typ !== 'JWT' || Object.keys(header).some((k) => !['alg', 'typ', 'kid'].includes(k))) {
            return { ok: false, reason: 'malformed' };
        }
        if (typeof header.kid !== 'string')
            return { ok: false, reason: 'unknown_kid' };
        const kid = header.kid;
        const key = this.keys.find((k) => k.kid === kid);
        if (!key)
            return { ok: false, reason: 'unknown_kid' };
        const expected = this.hmac(headerPart, bodyPart, kid);
        const given = base64urlDecode(signaturePart);
        if (expected.length !== given.length || !(0, node_crypto_1.timingSafeEqual)(expected, given)) {
            return { ok: false, reason: 'bad_signature' };
        }
        if (claims.iss !== exports.JWT_ISSUER)
            return { ok: false, reason: 'bad_issuer' };
        if (claims.aud !== exports.JWT_AUDIENCE)
            return { ok: false, reason: 'bad_audience' };
        const nowSec = Math.floor(now / 1000);
        if (typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) {
            return { ok: false, reason: 'bad_claims' };
        }
        if (claims.exp <= nowSec) {
            return { ok: false, reason: 'expired' };
        }
        if (typeof claims.nbf === 'number' &&
            claims.nbf > nowSec + 5) {
            return { ok: false, reason: 'not_yet_valid' };
        }
        const iat = claims.iat;
        if (typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat < 0 || iat > nowSec + 5 ||
            typeof claims.nbf !== 'number' || !Number.isSafeInteger(claims.nbf) || claims.nbf !== iat ||
            claims.exp <= iat || claims.exp - iat > 900 ||
            Object.keys(claims).some((k) => !['sub', 'sid', 'tid', 'iss', 'aud', 'iat', 'nbf', 'exp'].includes(k))) {
            return { ok: false, reason: 'bad_claims' };
        }
        const { sub, sid, tid } = claims;
        if (!(0, uuid_1.isUuidv7)(sub)) {
            return { ok: false, reason: 'bad_claims' };
        }
        if (!(0, uuid_1.isUuidv7)(sid)) {
            return { ok: false, reason: 'bad_claims' };
        }
        if (tid !== null && !(0, uuid_1.isUuidv7)(tid)) {
            return { ok: false, reason: 'bad_claims' };
        }
        return {
            ok: true,
            claims: {
                userId: sub,
                sessionId: sid,
                tenantId: typeof tid === 'string' ? tid : null,
                iat,
                exp: claims.exp,
            },
        };
    }
    hmac(headerPart, bodyPart, kid) {
        const key = this.keys.find((k) => k.kid === kid);
        return (0, node_crypto_1.createHmac)('sha256', key.secret).update(`${headerPart}.${bodyPart}`).digest();
    }
};
exports.TokenService = TokenService;
exports.TokenService = TokenService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], TokenService);
function newRefreshToken() {
    return `mzr_${base64urlEncode((0, node_crypto_1.randomBytes)(32))}`;
}
function hashOpaqueToken(presented) {
    return (0, node_crypto_1.createHash)('sha256').update(presented).digest('hex');
}
function newPendingToken() {
    return `mzp_${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
}
function isOpaqueToken(value, prefix) {
    return typeof value === 'string' && value.startsWith(prefix) && value.length === 47 && canonicalPart(value.slice(4));
}
//# sourceMappingURL=token.service.js.map