import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { bodyObject, normalizeEmail, parseLoginInput, parseLogoutInput, parseRegisterInput, validatePassword } from './auth.dto';
import { newPendingToken, newRefreshToken } from './token.service';

const register = { email: 'Owner@Example.test ', password: 'test-only long passphrase', name: "Owner's name", tenantName: ' Example ', tenantSlug: 'example-workspace' };
describe('Auth DTO parsing and secret-safe validation', () => {
  it('normalizes emails/workspace names, never passwords', () => {
    expect(parseRegisterInput(register)).toMatchObject({ email: 'owner@example.test', tenantName: 'Example', name: "Owner's name" });
    expect(parseLoginInput({ email: ' Owner@Example.test ', password: '  original password  ' }).password).toBe('  original password  ');
  });
  it.each([null, [], 'text', 42, { tenantId: 'foreign' }, JSON.parse('{"__proto__":{}}')])('rejects non-object or unknown request keys: %p', (body) => {
    expect(() => bodyObject(body, ['email'])).toThrow(BadRequestException);
  });
  it.each(['x', 'a@', '@example.test', 'x@example', 'x\r\n@example.test', 'a'.repeat(256)])('rejects malformed email input: %s', (value) => {
    expect(normalizeEmail(value)).toBeUndefined();
  });
  it('enforces 12–128 character passwords without trimming or truncating', () => {
    expect(() => validatePassword('x'.repeat(12))).not.toThrow();
    expect(() => validatePassword('x'.repeat(128))).not.toThrow();
    expect(() => validatePassword('x'.repeat(11))).toThrow(BadRequestException);
    expect(() => validatePassword('x'.repeat(129))).toThrow(BadRequestException);
  });
  it.each([{ tenantSlug: '../other' }, { tenantSlug: 'UPPER' }, { tenantSlug: 'a' }, { tenantName: '' }, { name: 'x'.repeat(151) }, { tenantId: 'foreign' }, { role: 'platform:admin' }])('rejects malformed or privilege-bearing registration fields: %p', (changes) => {
    expect(() => parseRegisterInput({ ...register, ...changes })).toThrow(BadRequestException);
  });
  it('accepts either documented invite alias, not both or mixed workspace creation', () => {
    const token = newPendingToken();
    const input = { email: register.email, password: register.password };
    expect(parseRegisterInput({ ...input, invite_token: token }).inviteToken).toBe(token);
    expect(parseRegisterInput({ ...input, inviteToken: token }).inviteToken).toBe(token);
    expect(() => parseRegisterInput({ ...input, inviteToken: token, invite_token: token })).toThrow(BadRequestException);
    expect(() => parseRegisterInput({ ...register, inviteToken: token })).toThrow(BadRequestException);
    expect(() => parseRegisterInput({ ...input, inviteToken: newRefreshToken() })).toThrow(BadRequestException);
  });
  it('uses one generic login error for invalid credential shapes', () => {
    for (const body of [{ email: 'bad', password: 'sensitive-secret' }, { email: register.email, password: null }]) {
      expect(() => parseLoginInput(body)).toThrow(UnauthorizedException);
      try { parseLoginInput(body); } catch (error) { expect(String(error)).not.toContain('sensitive-secret'); }
    }
  });
  it('allows current/all-session logout without letting a token select an identity', () => {
    expect(parseLogoutInput(undefined)).toEqual({});
    expect(parseLogoutInput({ allSessions: true, refreshToken: newRefreshToken() })).toHaveProperty('allSessions', true);
    expect(() => parseLogoutInput({ allSessions: 'true' })).toThrow(BadRequestException);
    expect(() => parseLogoutInput({ sessionId: 'foreign' })).toThrow(BadRequestException);
  });
});
