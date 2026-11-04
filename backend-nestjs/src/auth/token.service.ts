import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isUuidv7 } from '../common/ids/uuid';

/**
 * Access-token service (Phase 6A §8.2).
 *
 * HS256 access JWT with ONLY the approved claims: `sub` (user id), `sid`
 * (session id), `tid` (active tenant id or null), `iat`, `exp` — plus the
 * registered claims `iss`/`aud`/`nbf` validated on every request. **No
 * permissions, no email, no roles** — those are DB-resolved per request.
 *
 * Key rotation (§8.2): tokens carry a `kid` header. The current key signs
 * new tokens; an optional previous key keeps verifying already-issued tokens
 * while clients drain (two active keys).
 *
 * `JWT_SECRET` is REQUIRED in production (≥ 32 bytes) — the service fails
 * closed at construction. In development an ephemeral per-process secret is
 * generated when missing (tokens simply do not survive restarts).
 */

export const JWT_ISSUER = 'mczen-ai';
export const JWT_AUDIENCE = 'mczen-dashboard';

/** Minimum UTF-8 secret length (operator supplies ≥ 32 random bytes, §8.2). */
const MIN_SECRET_LENGTH = 32;

export interface AccessTokenPayload {
  userId: string;
  sessionId: string;
  tenantId: string | null;
}

export interface VerifiedToken extends AccessTokenPayload {
  iat: number;
  exp: number;
}

export type TokenVerifyError =
  | 'malformed' // not a 3-part JWT / bad JSON / bad header
  | 'bad_algorithm'
  | 'unknown_kid'
  | 'bad_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'bad_issuer'
  | 'bad_audience'
  | 'bad_claims'; // missing/wrong-typed claims

export class TokenConfigError extends Error {}

interface JwtKey {
  kid: string;
  secret: string;
}

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLength), 'base64');
}

/** Environment snapshot shared shape-without-values for testability. */
type TokenEnv = Record<string, string | undefined>;

/** TTL overrides, resolved once per construction (testable). */
export interface TokenServiceOptions {
  env?: TokenEnv;
}

function ttl(env: TokenEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TokenConfigError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function canonicalPart(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value) && base64urlDecode(value).toString('base64url') === value;
}

@Injectable()
export class TokenService {
  private readonly keys: JwtKey[];
  private readonly currentKid: string;
  private readonly accessTtlMs: number;
  private readonly refreshTtlSec: number;
  private readonly nowSource: () => number;

  constructor(options: TokenServiceOptions = {}) {
    const env = options.env ?? process.env;

    const isProduction = env.NODE_ENV === 'production';
    const secret = env.JWT_SECRET;

    if (!secret || Buffer.byteLength(secret, 'utf8') < MIN_SECRET_LENGTH) {
      if (isProduction) {
        throw new TokenConfigError(
          'JWT_SECRET is required in production and must be at least 32 bytes.',
        );
      }
      if (secret && Buffer.byteLength(secret, 'utf8') < MIN_SECRET_LENGTH) {
        // Present but short is a configuration error in ANY environment.
        throw new TokenConfigError(
          'JWT_SECRET must be at least 32 bytes when provided.',
        );
      }
    }

    if (secret === 'replace-with-32-bytes-of-random-secret') {
      throw new TokenConfigError('Replace the example JWT_SECRET with a randomly generated signing key.');
    }
    const effectiveSecret =
      secret ||
      base64urlEncode(randomBytes(MIN_SECRET_LENGTH)); // dev-only ephemeral

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

  get accessTtlSeconds(): number {
    return Math.round(this.accessTtlMs / 1000);
  }

  /** Refresh-token lifetime in seconds (default 30 days, §8.2). */
  get refreshTtlSeconds(): number {
    return this.refreshTtlSec;
  }

  /** Mints a signed access token for the given identity. */
  sign(payload: AccessTokenPayload, now = this.nowSource()): string {
    if (!isUuidv7(payload.userId) || !isUuidv7(payload.sessionId) || (payload.tenantId !== null && !isUuidv7(payload.tenantId))) {
      throw new Error('Cannot sign an invalid authentication identity.');
    }
    const iat = Math.floor(now / 1000);
    const header = base64urlEncode(
      JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: this.currentKid }),
    );
    const body = base64urlEncode(
      JSON.stringify({
        sub: payload.userId,
        sid: payload.sessionId,
        tid: payload.tenantId,
        iss: JWT_ISSUER,
        aud: JWT_AUDIENCE,
        iat,
        nbf: iat,
        exp: iat + this.accessTtlSeconds,
      }),
    );
    return `${header}.${body}.${this.hmac(header, body, this.currentKid).toString('base64url')}`;
  }

  /**
   * Verifies an access token: format, algorithm, key id, timing-safe
   * signature, temporal claims (exp/nbf/iat ordering), issuer and audience —
   * then typed claims. Returns a discriminated result instead of throwing so
   * the guard can map every failure to the SAME generic 401.
   */
  verify(
    token: string,
    now = this.nowSource(),
  ): { ok: true; claims: VerifiedToken } | { ok: false; reason: TokenVerifyError } {
    if (typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'malformed' };
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(canonicalPart)) return { ok: false, reason: 'malformed' };
    const [headerPart, bodyPart, signaturePart] = parts;

    let header: { alg?: unknown; kid?: unknown; typ?: unknown };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(base64urlDecode(headerPart).toString('utf8'));
      claims = JSON.parse(base64urlDecode(bodyPart).toString('utf8'));
      if (!header || typeof header !== 'object' || Array.isArray(header) || !claims || typeof claims !== 'object' || Array.isArray(claims)) {
        return { ok: false, reason: 'malformed' };
      }
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    if (header.alg !== 'HS256') return { ok: false, reason: 'bad_algorithm' };
    if (header.typ !== 'JWT' || Object.keys(header).some((k) => !['alg', 'typ', 'kid'].includes(k))) {
      return { ok: false, reason: 'malformed' };
    }

    if (typeof header.kid !== 'string') return { ok: false, reason: 'unknown_kid' };
    const kid = header.kid;
    const key = this.keys.find((k) => k.kid === kid);
    if (!key) return { ok: false, reason: 'unknown_kid' };

    const expected = this.hmac(headerPart, bodyPart, kid);
    const given = base64urlDecode(signaturePart);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return { ok: false, reason: 'bad_signature' };
    }

    if (claims.iss !== JWT_ISSUER) return { ok: false, reason: 'bad_issuer' };
    if (claims.aud !== JWT_AUDIENCE) return { ok: false, reason: 'bad_audience' };

    const nowSec = Math.floor(now / 1000);
    if (typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) {
      return { ok: false, reason: 'bad_claims' };
    }
    if (claims.exp <= nowSec) {
      return { ok: false, reason: 'expired' };
    }
    if (
      typeof claims.nbf === 'number' &&
      claims.nbf > nowSec + 5 // small clock skew allowance
    ) {
      return { ok: false, reason: 'not_yet_valid' };
    }
    const iat = claims.iat;
    if (typeof iat !== 'number' || !Number.isSafeInteger(iat) || iat < 0 || iat > nowSec + 5 ||
      typeof claims.nbf !== 'number' || !Number.isSafeInteger(claims.nbf) || claims.nbf !== iat ||
      claims.exp <= iat || claims.exp - iat > 900 ||
      Object.keys(claims).some((k) => !['sub', 'sid', 'tid', 'iss', 'aud', 'iat', 'nbf', 'exp'].includes(k))) {
      return { ok: false, reason: 'bad_claims' };
    }

    // Approved claim set ONLY: sub/sid/tid (+ registered claims).
    const { sub, sid, tid } = claims;
    if (!isUuidv7(sub)) {
      return { ok: false, reason: 'bad_claims' };
    }
    if (!isUuidv7(sid)) {
      return { ok: false, reason: 'bad_claims' };
    }
    if (tid !== null && !isUuidv7(tid)) {
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

  private hmac(headerPart: string, bodyPart: string, kid: string): Buffer {
    const key = this.keys.find((k) => k.kid === kid)!;
    return createHmac('sha256', key.secret).update(`${headerPart}.${bodyPart}`).digest();
  }
}

/** Opaque refresh-token material helpers (Phase 6A §4.6/§8.2). */
export function newRefreshToken(): string {
  // 256-bit random, `mzr_` prefixed for identification; SHA-256 hash stored.
  return `mzr_${base64urlEncode(randomBytes(32))}`;
}

export function hashOpaqueToken(presented: string): string {
  return createHash('sha256').update(presented).digest('hex');
}

/** Separate credential class, with the same approved 256-bit entropy. */
export function newPendingToken(): string {
  return `mzp_${randomBytes(32).toString('base64url')}`;
}

export function isOpaqueToken(value: unknown, prefix: 'mzr_' | 'mzp_'): value is string {
  return typeof value === 'string' && value.startsWith(prefix) && value.length === 47 && canonicalPart(value.slice(4));
}
