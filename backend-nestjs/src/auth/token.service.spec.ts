import { createHash, createHmac } from 'node:crypto';
import { newUuidv7 } from '../common/ids/uuid';
import { TokenService, TokenConfigError, JWT_AUDIENCE, JWT_ISSUER, hashOpaqueToken, isOpaqueToken, newPendingToken, newRefreshToken } from './token.service';

const SECRET = 'test-only-signing-key-32-bytes-or-more';
const OLD_SECRET = 'test-only-previous-key-32-bytes-or-more';
const NOW = 1_800_000_000_000;
const payload = { userId: newUuidv7(), sessionId: newUuidv7(), tenantId: newUuidv7() };
const service = new TokenService({ env: { JWT_SECRET: SECRET } });
function encode(value: unknown): string { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function signed(claimChanges: Record<string, unknown> = {}, headerChanges: Record<string, unknown> = {}): string {
  const header = encode({ alg: 'HS256', typ: 'JWT', kid: 'v1', ...headerChanges });
  const body = encode({ sub: payload.userId, sid: payload.sessionId, tid: payload.tenantId,
    iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: NOW / 1000, nbf: NOW / 1000, exp: NOW / 1000 + 900, ...claimChanges });
  return `${header}.${body}.${createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')}`;
}

describe('TokenService (HS256 access JWT)', () => {
  it('signs a canonical token with ONLY the approved claims', () => {
    const token = service.sign(payload, NOW);
    expect(service.verify(token, NOW)).toEqual({ ok: true, claims: { ...payload, iat: NOW / 1000, exp: NOW / 1000 + 900 } });
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())).toEqual({
      sub: payload.userId, sid: payload.sessionId, tid: payload.tenantId, iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: NOW / 1000, nbf: NOW / 1000, exp: NOW / 1000 + 900,
    });
    expect(token.split('.')[2]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('supports an identity-only token with an explicit null tenant', () => {
    expect(service.verify(service.sign({ ...payload, tenantId: null }, NOW), NOW)).toMatchObject({ ok: true, claims: { tenantId: null } });
  });
  it('expires at the exact exp boundary without an expiry grace period', () => {
    const token = service.sign(payload, NOW);
    expect(service.verify(token, NOW + 899_000).ok).toBe(true);
    expect(service.verify(token, NOW + 900_000)).toEqual({ ok: false, reason: 'expired' });
  });
  it('rejects a tampered tenant hint even when it is a valid UUID', () => {
    const token = service.sign(payload, NOW).split('.');
    const claims = JSON.parse(Buffer.from(token[1], 'base64url').toString());
    token[1] = encode({ ...claims, tid: newUuidv7() });
    expect(service.verify(token.join('.'), NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it.each(['', 'mzr_secret', 'wgt_secret', 'a.b.c', 'x'.repeat(2049), 'a.b', 'a.b.c.d'])('rejects malformed/other-class credentials safely: %s', (token) => {
    expect(service.verify(token, NOW).ok).toBe(false);
  });
  it.each([{ alg: 'none' }, { alg: 'HS512' }, { typ: 'OTHER' }, { kid: undefined }, { kid: 'unknown' }, { jku: 'https://example.test/key' }])('rejects unsafe JWT headers: %p', (changes) => {
    expect(service.verify(signed({}, changes), NOW).ok).toBe(false);
  });
  it.each([
    { sub: undefined }, { sub: 'tenant-a' }, { sid: 'wrong-session' }, { tid: undefined }, { tid: 'tenant-b' },
    { iss: 'another-issuer' }, { aud: 'another-audience' }, { exp: '1800000900' }, { exp: NOW / 1000 + 0.5 },
    { exp: NOW / 1000 + 901 }, { exp: NOW / 1000 }, { iat: -1 }, { iat: NOW / 1000 + 0.5 }, { nbf: undefined },
    { nbf: NOW / 1000 - 1 }, { nbf: NOW / 1000 + 10, iat: NOW / 1000 + 10 },
    { permissions: ['users:manage'] }, { role: 'platform:admin' }, { email: 'test@example.test' },
  ])('rejects missing, malformed or unapproved claims: %p', (changes) => {
    expect(service.verify(signed(changes), NOW).ok).toBe(false);
  });
  it('rejects padded and non-canonical base64url aliases', () => {
    const token = service.sign(payload, NOW).split('.');
    expect(service.verify(`${token[0]}=.${token[1]}.${token[2]}`, NOW).ok).toBe(false);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(token[2].slice(-1));
    token[2] = token[2].slice(0, -1) + alphabet[last + 1]; // same decoded bytes, different unused padding bits
    expect(service.verify(token.join('.'), NOW).ok).toBe(false);
  });
  it('validates both named keys during rotation and rejects the retired key afterwards', () => {
    const previous = new TokenService({ env: { JWT_SECRET: OLD_SECRET, JWT_CURRENT_KID: 'v0' } });
    const rotated = new TokenService({ env: { JWT_SECRET: SECRET, JWT_CURRENT_KID: 'v1', JWT_PREVIOUS_SECRET: OLD_SECRET, JWT_PREVIOUS_KID: 'v0' } });
    expect(rotated.verify(previous.sign(payload, NOW), NOW).ok).toBe(true);
    expect(rotated.verify(rotated.sign(payload, NOW), NOW).ok).toBe(true);
    expect(service.verify(previous.sign(payload, NOW), NOW).ok).toBe(false);
  });
  it('uses an ephemeral development key but fails closed without a production key', () => {
    const a = new TokenService({ env: {} });
    const b = new TokenService({ env: {} });
    expect(a.verify(a.sign(payload, NOW), NOW).ok).toBe(true);
    expect(b.verify(a.sign(payload, NOW), NOW).ok).toBe(false);
    expect(() => new TokenService({ env: { NODE_ENV: 'production' } })).toThrow(TokenConfigError);
  });
  it.each([
    { JWT_SECRET: 'short-sensitive-value' }, { JWT_SECRET: 'replace-with-32-bytes-of-random-secret' },
    { JWT_PREVIOUS_SECRET: 'short' }, { JWT_PREVIOUS_SECRET: OLD_SECRET, JWT_PREVIOUS_KID: 'v1' },
    { JWT_PREVIOUS_SECRET: 'replace-with-32-bytes-of-random-secret' }, { JWT_CURRENT_KID: '../../key' },
    { AUTH_ACCESS_TOKEN_TTL_SECONDS: '599' }, { AUTH_ACCESS_TOKEN_TTL_SECONDS: '901' }, { AUTH_ACCESS_TOKEN_TTL_SECONDS: 'NaN' },
    { AUTH_REFRESH_TOKEN_TTL_SECONDS: '2592001' }, { AUTH_REFRESH_TOKEN_TTL_SECONDS: '0' },
  ])('rejects invalid configuration without echoing secret values: %p', (env) => {
    expect(() => new TokenService({ env: { JWT_SECRET: SECRET, ...env } })).toThrow(TokenConfigError);
    try { new TokenService({ env: { JWT_SECRET: SECRET, ...env } }); } catch (error) { expect(String(error)).not.toContain('short-sensitive-value'); }
  });
  it('supports the approved TTL lower bounds and UTF-8 byte-length key validation', () => {
    const reduced = new TokenService({ env: { JWT_SECRET: '界'.repeat(11), AUTH_ACCESS_TOKEN_TTL_SECONDS: '600', AUTH_REFRESH_TOKEN_TTL_SECONDS: '1' } });
    expect(reduced.accessTtlSeconds).toBe(600);
    expect(reduced.refreshTtlSeconds).toBe(1);
  });
  it('never signs a malformed identity', () => {
    expect(() => service.sign({ ...payload, userId: 'not-an-id' }, NOW)).toThrow();
  });
});

describe('Opaque credential material', () => {
  it('creates distinct 256-bit prefixed credentials with canonical encoding', () => {
    const refresh = newRefreshToken();
    const pending = newPendingToken();
    expect(isOpaqueToken(refresh, 'mzr_')).toBe(true);
    expect(isOpaqueToken(pending, 'mzp_')).toBe(true);
    expect(Buffer.from(refresh.slice(4), 'base64url').length).toBe(32);
    expect(isOpaqueToken(pending, 'mzr_')).toBe(false);
    expect(isOpaqueToken(`${refresh}=`, 'mzr_')).toBe(false);
    expect(newRefreshToken()).not.toBe(refresh);
  });
  it('uses approved plain SHA-256 and never returns the original credential', () => {
    const raw = newRefreshToken();
    expect(hashOpaqueToken(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hashOpaqueToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueToken(raw)).not.toContain(raw);
  });
});
