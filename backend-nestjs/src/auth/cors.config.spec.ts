import { ForbiddenException } from '@nestjs/common';
import { CorsConfigError, readCorsOptions } from './cors.config';
import { allowDevelopmentTokens, isDirectLoopback } from './loopback';

describe('Exact dashboard CORS configuration', () => {
  it('preserves the two existing local defaults without credentials', () => {
    const cors = readCorsOptions({});
    const callback = jest.fn();
    (cors.origin as Function)('http://localhost:5174', callback);
    expect(callback).toHaveBeenCalledWith(null, true);
    expect(cors.credentials).toBe(false);
    expect(cors.allowedHeaders).not.toContain('x-mczen-tenant-id');
  });
  it('accepts only exact configured production HTTPS origins', () => {
    const cors = readCorsOptions({ NODE_ENV: 'production', MCZEN_CORS_ORIGINS: 'https://dashboard.example.test', MCZEN_ALLOW_DEV_HEADER: '1' });
    const yes = jest.fn();
    const no = jest.fn();
    (cors.origin as Function)('https://dashboard.example.test', yes);
    (cors.origin as Function)('https://dashboard.example.test.attacker.test', no);
    expect(yes).toHaveBeenCalledWith(null, true);
    expect(no).toHaveBeenCalledWith(expect.any(ForbiddenException), false);
    expect(cors.allowedHeaders).not.toContain('x-mczen-tenant-id');
    expect(cors.exposedHeaders).toContain('Retry-After');
  });
  it('denies browser origins by default in production but permits non-browser callers', () => {
    const cors = readCorsOptions({ NODE_ENV: 'production' });
    const denied = jest.fn();
    const api = jest.fn();
    (cors.origin as Function)('https://example.test', denied);
    (cors.origin as Function)(undefined, api);
    expect(denied).toHaveBeenCalledWith(expect.any(ForbiddenException), false);
    expect(api).toHaveBeenCalledWith(null, true);
  });
  it.each(['*', 'https://example.test/path', 'https://user:secret@example.test', 'https://example.test/', 'http://example.test', 'null'])('rejects unsafe production origins: %s', (value) => {
    expect(() => readCorsOptions({ NODE_ENV: 'production', MCZEN_CORS_ORIGINS: value })).toThrow(CorsConfigError);
  });
});

describe('Development pending-token exposure', () => {
  const original = { node: process.env.NODE_ENV, flag: process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS };
  beforeEach(() => { process.env.NODE_ENV = 'test'; process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS = '1'; });
  afterAll(() => {
    if (original.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.node;
    if (original.flag === undefined) delete process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS; else process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS = original.flag;
  });
  it('requires all three gates: explicit flag, non-production, direct loopback', () => {
    expect(allowDevelopmentTokens({}, '127.0.0.1')).toBe(true);
    expect(allowDevelopmentTokens({}, '203.0.113.1')).toBe(false);
    expect(allowDevelopmentTokens({ 'x-forwarded-for': '127.0.0.1' }, '127.0.0.1')).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(allowDevelopmentTokens({}, '127.0.0.1')).toBe(false);
    process.env.NODE_ENV = 'test';
    delete process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS;
    expect(allowDevelopmentTokens({}, '127.0.0.1')).toBe(false);
  });
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('recognizes the exact direct loopback peer representation: %s', (ip) => {
    expect(isDirectLoopback({}, ip)).toBe(true);
  });
});
