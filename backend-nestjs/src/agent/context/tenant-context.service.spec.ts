import { UnauthorizedException } from '@nestjs/common';
import { DEV_TENANT_HEADER, TenantContextService } from './tenant-context.service';
import { tenantContextStore, TenantContextMissingError } from '../../common/tenant/tenant-context.store';
import { newUuidv7 } from '../../common/ids/uuid';

describe('TenantContextService', () => {
  const service = new TenantContextService();
  const original = { node: process.env.NODE_ENV, flag: process.env.MCZEN_ALLOW_DEV_HEADER };
  const resolve = (headers: Record<string, string | string[] | undefined>, ip = '127.0.0.1') => service.resolveDevelopment(headers, ip);

  beforeEach(() => { process.env.NODE_ENV = 'test'; process.env.MCZEN_ALLOW_DEV_HEADER = '1'; });
  afterAll(() => {
    if (original.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.node;
    if (original.flag === undefined) delete process.env.MCZEN_ALLOW_DEV_HEADER; else process.env.MCZEN_ALLOW_DEV_HEADER = original.flag;
  });

  it('resolves the explicitly enabled loopback development tenant', () => {
    const context = resolve({ [DEV_TENANT_HEADER]: 'tenant-a' });
    expect(context.tenantId).toBe('tenant-a');
    expect(context.permissions).toContain('products:read');
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.isFrozen(context.permissions)).toBe(true);
  });
  it('accepts a single-element array form of the legacy header', () => {
    expect(resolve({ [DEV_TENANT_HEADER]: ['tenant-b'] }).permissions).toContain('school:read');
  });
  it('rejects a missing tenant identity — no default tenant', () => {
    expect(() => resolve({})).toThrow(UnauthorizedException);
    expect(() => resolve({ [DEV_TENANT_HEADER]: '   ' })).toThrow(UnauthorizedException);
  });
  it('rejects unknown tenant identities', () => {
    expect(() => resolve({ [DEV_TENANT_HEADER]: 'tenant-x' })).toThrow(UnauthorizedException);
  });
  it('rejects the development header in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => resolve({ [DEV_TENANT_HEADER]: 'tenant-a' })).toThrow(UnauthorizedException);
  });
  it('rejects missing identity in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => resolve({})).toThrow(UnauthorizedException);
  });
  it('fails closed without explicit opt-in', () => {
    delete process.env.MCZEN_ALLOW_DEV_HEADER;
    expect(() => resolve({ [DEV_TENANT_HEADER]: 'tenant-a' })).toThrow(UnauthorizedException);
  });
  it.each(['203.0.113.1', '127.0.0.2', ''])('rejects non-approved raw peers: %s', (ip) => {
    expect(() => resolve({ [DEV_TENANT_HEADER]: 'tenant-a' }, ip)).toThrow(UnauthorizedException);
  });
  it('rejects ambiguous headers and forwarded peer claims', () => {
    expect(() => resolve({ [DEV_TENANT_HEADER]: ['tenant-a', 'tenant-b'] })).toThrow(UnauthorizedException);
    expect(() => resolve({ [DEV_TENANT_HEADER]: 'tenant-a', 'x-forwarded-for': '127.0.0.1' })).toThrow(UnauthorizedException);
  });
  it('normal resolution fails closed outside the verified ALS pipeline', () => {
    expect(() => service.resolve()).toThrow(TenantContextMissingError);
  });
  it('normal production resolution delegates to the verified context, not headers', () => {
    process.env.NODE_ENV = 'production';
    const tenantId = newUuidv7();
    tenantContextStore.run({ tenantId, actorType: 'user', permissions: ['knowledge:read'], requestId: 'req-verified' }, () => {
      expect(service.resolve()).toMatchObject({ tenantId, permissions: ['knowledge:read'], requestId: 'req-verified' });
    });
    expect(tenantContextStore.get()).toBeUndefined();
  });
});
