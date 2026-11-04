import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitConfigError, RateLimitService } from './rate-limit.service';
import type { AuthenticatedRequest } from './auth-context';
import { newRefreshToken } from './token.service';

function req(ip = '127.0.0.1', body: unknown = {}): AuthenticatedRequest {
  return { socket: { remoteAddress: ip }, body, headers: {} } as AuthenticatedRequest;
}
function res(): Response { return { setHeader: jest.fn() } as unknown as Response; }
const user = { userId: 'test-user', sessionId: 'test-session', activeTenantId: 'test-tenant' };
const tenant = { tenantId: 'test-tenant', actorType: 'user' as const, permissions: [] };

describe('Bounded authentication/edge rate limiting', () => {
  it('enforces a sliding IP window and a meaningful Retry-After', () => {
    let now = 1000;
    const limiter = new RateLimitService({ env: { MCZEN_RATE_IP_PER_MINUTE: '2' }, now: () => now });
    const response = res();
    limiter.checkRequest(req(), response);
    limiter.checkRequest(req(), response);
    now += 59_000;
    expect(() => limiter.checkRequest(req(), response)).toThrow(HttpException);
    expect(response.setHeader).toHaveBeenLastCalledWith('Retry-After', 1);
    now += 1000;
    expect(() => limiter.checkRequest(req(), response)).not.toThrow();
  });
  it('enforces auth-specific limits before password verification', () => {
    const limiter = new RateLimitService({ env: {} });
    for (let i = 0; i < 5; i++) limiter.checkRequest(req(), res(), 'register');
    expect(() => limiter.checkRequest(req(), res(), 'register')).toThrow(HttpException);
  });
  it('charges an edge-checked request once while still enforcing its auth policy', () => {
    const limiter = new RateLimitService({ env: { MCZEN_RATE_IP_PER_MINUTE: '1' } });
    const incoming = req();
    limiter.checkEdge(incoming, res());
    expect(() => limiter.checkRequest(incoming, res(), 'login')).not.toThrow();
    expect(() => limiter.checkEdge(req(), res())).toThrow(HttpException);
  });
  it('normalizes and hashes mailbox limits across different raw peers', () => {
    const limiter = new RateLimitService({ env: {} });
    for (let i = 0; i < 10; i++) limiter.checkRequest(req(`203.0.113.${i}`, { email: ' Owner@Example.test ' }), res(), 'login');
    expect(() => limiter.checkRequest(req('203.0.113.22', { email: 'owner@example.test' }), res(), 'login')).toThrow(HttpException);
  });
  it('does not trust forwarding headers to reset the IP quota', () => {
    const limiter = new RateLimitService({ env: { MCZEN_RATE_IP_PER_MINUTE: '1' } });
    limiter.checkRequest(req(), res());
    const second = req();
    second.headers['x-forwarded-for'] = '203.0.113.77';
    expect(() => limiter.checkRequest(second, res())).toThrow(HttpException);
  });
  it('keys buckets on the trust-proxy-aware request.ip when Express provides it', () => {
    const limiter = new RateLimitService({ env: { MCZEN_RATE_IP_PER_MINUTE: '1' } });
    const proxied = req('127.0.0.1');
    (proxied as { ip?: string }).ip = '198.51.100.7';
    limiter.checkRequest(proxied, res());
    // The same visitor behind the trusted proxy (same request.ip) is limited even
    // though the raw socket peer is always the local Nginx address.
    const again = req('127.0.0.1');
    (again as { ip?: string }).ip = '198.51.100.7';
    expect(() => limiter.checkRequest(again, res())).toThrow(HttpException);
    // A different visitor behind the same proxy still gets its own bucket.
    expect(() => limiter.checkRequest(req('127.0.0.1'), res())).not.toThrow();
  });
  it('limits a verified session independently of IP and JWT rotation', () => {
    const limiter = new RateLimitService({ env: { MCZEN_RATE_SESSION_PER_MINUTE: '1' } });
    limiter.checkContext(res(), user);
    expect(() => limiter.checkContext(res(), user)).toThrow(HttpException);
  });
  it('limits a tenant across multiple independent sessions', () => {
    const limiter = new RateLimitService({ env: { MCZEN_RATE_TENANT_PER_MINUTE: '1' } });
    limiter.checkContext(res(), user, tenant);
    expect(() => limiter.checkContext(res(), { ...user, sessionId: 'other-session' }, tenant)).toThrow(HttpException);
  });
  it('hashes opaque refresh tokens and never retains raw sensitive key material', () => {
    const limiter = new RateLimitService({ env: {} });
    const token = newRefreshToken();
    limiter.checkRequest(req('203.0.113.99', { refreshToken: token }), res(), 'refresh');
    limiter.checkRequest(req('203.0.113.99', { email: 'private@example.test' }), res(), 'login');
    limiter.checkContext(res(), user, tenant);
    const keys = [...(limiter as unknown as { buckets: Map<string, unknown> }).buckets.keys()].join('\n');
    for (const raw of [token, '203.0.113.99', 'private@example.test', user.sessionId, tenant.tenantId]) expect(keys).not.toContain(raw);
    expect(keys).toContain('refresh:');
  });
  it('fails closed at bounded capacity without evicting an active quota', () => {
    let now = 1000;
    const limiter = new RateLimitService({ env: { MCZEN_RATE_MAX_KEYS: '1', MCZEN_RATE_IP_PER_MINUTE: '1' }, now: () => now });
    limiter.checkRequest(req('203.0.113.1'), res());
    expect(() => limiter.checkRequest(req('203.0.113.2'), res())).toThrow(HttpException);
    expect(() => limiter.checkRequest(req('203.0.113.1'), res())).toThrow(HttpException);
    now += 60_000;
    expect(() => limiter.checkRequest(req('203.0.113.2'), res())).not.toThrow();
  });
  it.each([{ MCZEN_RATE_IP_PER_MINUTE: '0' }, { MCZEN_RATE_IP_PER_MINUTE: '301' }, { MCZEN_RATE_SESSION_PER_MINUTE: '121' }, { MCZEN_RATE_TENANT_PER_MINUTE: '601' }, { MCZEN_RATE_MAX_KEYS: '10001' }, { MCZEN_RATE_MAX_KEYS: 'oops' }])('rejects unsafe rate-limit configuration: %p', (env) => {
    expect(() => new RateLimitService({ env })).toThrow(RateLimitConfigError);
  });
});
