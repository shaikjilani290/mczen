import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth-context';
import type { AuthRatePolicy } from './auth.decorators';
import type { TenantContext } from '../common/tenant/tenant-context.store';
import { normalizeEmail } from './auth.dto';
import { isOpaqueToken } from './token.service';

export class RateLimitConfigError extends Error {}
const WINDOW_MS = 60_000;
const EDGE_RATE_CHECKED = Symbol('MCZEN_EDGE_RATE_CHECKED');
const AUTH_LIMITS: Record<AuthRatePolicy, number> = { register: 5, login: 10, refresh: 30, forgot: 5, reset: 5, verify: 10 };
interface Bucket { times: number[]; expiresAt: number }
export interface RateLimitOptions { env?: Record<string, string | undefined>; now?: () => number }

function setting(env: Record<string, string | undefined>, key: string, fallback: number, ceiling: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new RateLimitConfigError(`${key} must be an integer between 1 and ${ceiling}.`);
  return value;
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

/**
 * The rate-limit peer: Express resolves `request.ip` from the socket peer and,
 * only when `MCZEN_TRUST_PROXY` names an explicit proxy address, from the
 * forwarding headers that trusted proxy sent. The local Nginx overwrites
 * X-Forwarded-For with the real remote address, so per-IP buckets then key on
 * genuine visitor IPs; without the setting the socket peer is used, exactly as
 * before. The fallbacks cover unit-test request mocks without an Express shim.
 */
function peerAddress(request: AuthenticatedRequest): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown-peer';
}

/**
 * Bounded process-local sliding windows. No raw JWTs, opaque tokens, emails or
 * IPs are retained. Capacity exhaustion fails closed; active buckets are NEVER
 * evicted to let an attacker reset a quota. Multi-instance limits need a shared
 * edge/Redis store in the deployment phase; this is not claimed cluster-wide.
 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly ipLimit: number;
  private readonly sessionLimit: number;
  private readonly tenantLimit: number;
  private readonly maxKeys: number;
  private nextSweep = 0;

  constructor(options: RateLimitOptions = {}) {
    const env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
    this.ipLimit = setting(env, 'MCZEN_RATE_IP_PER_MINUTE', 300, 300);
    this.sessionLimit = setting(env, 'MCZEN_RATE_SESSION_PER_MINUTE', 120, 120);
    this.tenantLimit = setting(env, 'MCZEN_RATE_TENANT_PER_MINUTE', 600, 600);
    this.maxKeys = setting(env, 'MCZEN_RATE_MAX_KEYS', 10_000, 10_000);
  }

  checkRequest(request: AuthenticatedRequest, response: Response, policy?: AuthRatePolicy): void {
    // `request.ip` is the socket peer unless MCZEN_TRUST_PROXY explicitly names
    // the proxy; arbitrary client X-Forwarded-For values are never consulted.
    const ip = digest(peerAddress(request));
    if (!(request as AuthenticatedRequest & { [EDGE_RATE_CHECKED]?: boolean })[EDGE_RATE_CHECKED]) {
      this.consume(`ip:${ip}`, this.ipLimit, response);
    }
    if (!policy) return;
    this.consume(`auth:${policy}:${ip}`, AUTH_LIMITS[policy], response);
    if (policy === 'login' || policy === 'forgot') {
      const email = normalizeEmail(request.body?.email);
      if (email) this.consume(`mailbox:${policy}:${digest(email)}`, AUTH_LIMITS[policy], response);
    }
    if (policy === 'refresh' && isOpaqueToken(request.body?.refreshToken, 'mzr_')) {
      this.consume(`refresh:${digest(request.body.refreshToken)}`, AUTH_LIMITS.refresh, response);
    }
  }

  /** HTTP middleware calls this before CORS, routing and JSON parsing. */
  checkEdge(request: AuthenticatedRequest, response: Response): void {
    this.consume(`ip:${digest(peerAddress(request))}`, this.ipLimit, response);
    // Cannot originate from headers/body/query; prevents charging the IP twice.
    Object.defineProperty(request, EDGE_RATE_CHECKED, { value: true });
  }

  checkContext(response: Response, user?: AuthenticatedUser, tenant?: TenantContext): void {
    if (user) this.consume(`session:${digest(user.sessionId)}`, this.sessionLimit, response);
    if (tenant) this.consume(`tenant:${digest(tenant.tenantId)}`, this.tenantLimit, response);
  }

  private consume(key: string, limit: number, response: Response): void {
    const now = this.now();
    if (now >= this.nextSweep) {
      for (const [name, bucket] of this.buckets) if (bucket.expiresAt <= now) this.buckets.delete(name);
      this.nextSweep = now + 5_000;
    }
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) {
        // Allow reclamation at exact expiry even if the amortized sweep is not due.
        for (const [name, candidate] of this.buckets) if (candidate.expiresAt <= now) this.buckets.delete(name);
        if (this.buckets.size >= this.maxKeys) return this.deny(response, 60);
      }
      bucket = { times: [], expiresAt: now + WINDOW_MS };
      this.buckets.set(key, bucket);
    }
    bucket.times = bucket.times.filter((time) => time > now - WINDOW_MS);
    if (bucket.times.length >= limit) return this.deny(response, Math.ceil((bucket.times[0] + WINDOW_MS - now) / 1000));
    bucket.times.push(now);
    bucket.expiresAt = now + WINDOW_MS;
  }

  private deny(response: Response, retryAfter: number): never {
    response.setHeader('Retry-After', Math.max(1, retryAfter));
    throw new HttpException({ statusCode: 429, error: 'Too Many Requests', message: 'Too many requests.' }, 429);
  }
}
