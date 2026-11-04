import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { AUTH_CONTEXT, REQUEST_ID, TENANT_CONTEXT } from '../auth/auth-context';
import { newUuidv7 } from '../common/ids/uuid';
import { AuditController, PlatformAuditController } from './audit.controller';
import { AUDITED, AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { sanitizeMetadata } from './audit.sanitize';
import { AuditEvents1740000000012 } from '../database/migrations/1740000000012-AuditEvents';
import { ALL_MIGRATIONS } from '../database/migrations';

describe('sanitizeMetadata', () => {
  it('drops sensitive keys, nested values and credential-looking strings', () => {
    const result = sanitizeMetadata({
      fields: 'name,theme',
      password: 'x', apiKey: 'k', accessToken: 't', secretValue: 's', ciphertext: 'c', authorization: 'Bearer abc', audio: 'AAAA', value: 'v',
      publicKey: 'wk_abcdefghijkl',
      note: 'Bearer abcdefghijklmnop',
      jwtLike: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig',
      nested: { a: 1 }, list: [1, 2], count: 3, ok: true, none: null,
    });
    expect(result).toEqual({ fields: 'name,theme', count: 3, ok: true, none: null });
  });

  it('truncates long strings, caps key count and returns null for empty or non-objects', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, i]));
    expect(Object.keys(sanitizeMetadata(many) ?? {})).toHaveLength(20);
    expect((sanitizeMetadata({ text: 'a'.repeat(500) }) as { text: string }).text).toHaveLength(200);
    expect(sanitizeMetadata({ password: 'x' })).toBeNull();
    expect(sanitizeMetadata('x')).toBeNull();
    expect(sanitizeMetadata([1])).toBeNull();
  });
});

describe('AuditService', () => {
  it('writes a sanitised, parameterised row and never stores secret metadata', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const service = new AuditService({ query } as never);
    const tenantId = newUuidv7();
    await service.record({ scope: 'tenant', tenantId, actorType: 'user', actorId: newUuidv7(), action: 'x.y', metadata: { fields: 'a', token: 'zzz' } });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO `audit_events`');
    expect(sql).not.toContain(tenantId);
    expect(JSON.parse(params[9] as string)).toEqual({ fields: 'a' });
    expect(JSON.stringify(params)).not.toContain('zzz');
  });

  it('never throws on database failure and counts the failure', async () => {
    const service = new AuditService({ query: jest.fn().mockRejectedValue(new Error('db down')) } as never);
    await expect(service.record({ scope: 'platform', actorType: 'system', action: 'a.b' })).resolves.toBeUndefined();
    expect(service.failureCount).toBe(1);
  });

  it('lists with scope and tenant filters bound as parameters and paginates by id', async () => {
    const tenantId = newUuidv7();
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: String(10 - i), scope: 'tenant', tenant_id: Buffer.alloc(16, 1), actor_type: 'user', actor_id: 'u', action: 'a',
      resource_type: null, resource_id: null, outcome: 'success', request_id: null, metadata: '{"fields":"a"}', created_at: new Date(),
    }));
    const query = jest.fn().mockResolvedValue(rows);
    const service = new AuditService({ query } as never);
    const page = await service.list({ scope: 'tenant', tenantId, limit: 2, action: 'a' });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('`scope`=?');
    expect(sql).toContain('`tenant_id`=?');
    expect(sql).not.toContain(tenantId);
    expect(params[0]).toBe('tenant');
    expect(page.items).toHaveLength(2);
    expect(page.nextBeforeId).toBe('9');
    expect(page.items[0].metadata).toEqual({ fields: 'a' });
  });
});

describe('AuditInterceptor', () => {
  const options = { action: 'tool.config.update', resourceType: 'tool', idParam: 'toolName', valueFields: ['enabled'] as const };
  function setup(opts: object | null = options) {
    const record = jest.fn().mockResolvedValue(undefined);
    const reflector = { get: jest.fn((key: symbol) => (key === AUDITED ? opts ?? undefined : undefined)) } as unknown as Reflector;
    const interceptor = new AuditInterceptor(reflector, { record } as never);
    const tenantId = newUuidv7();
    const request = {
      params: { toolName: 'tool_a' },
      body: { enabled: true, secret: 'topsecret', config: { a: 1 } },
      [AUTH_CONTEXT]: { userId: newUuidv7(), sessionId: 's', activeTenantId: tenantId },
      [TENANT_CONTEXT]: { tenantId, actorType: 'user', permissions: [] },
      [REQUEST_ID]: 'req-1',
    };
    const context = { getHandler: () => () => undefined, switchToHttp: () => ({ getRequest: () => request }) } as never;
    return { interceptor, record, context, tenantId, request };
  }

  it('records success with body field names (not values), whitelisted values and the verified tenant', async () => {
    const { interceptor, record, context, tenantId } = setup();
    await lastValueFrom(interceptor.intercept(context, { handle: () => of('ok') }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'tenant', tenantId, actorType: 'user', action: 'tool.config.update', resourceId: 'tool_a', outcome: 'success', requestId: 'req-1',
      metadata: { fields: 'enabled,secret,config', enabled: true },
    }));
    expect(JSON.stringify(record.mock.calls)).not.toContain('topsecret');
  });

  it('records denied and failure outcomes and rethrows the original error', async () => {
    for (const [error, outcome] of [[new ForbiddenException(), 'denied'], [new BadRequestException(), 'failure']] as const) {
      const { interceptor, record, context } = setup();
      await expect(lastValueFrom(interceptor.intercept(context, { handle: () => throwError(() => error) }))).rejects.toBe(error);
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome }));
    }
  });

  it('is a no-op for handlers without @Audited and uses the target tenant for platform actions', async () => {
    const plain = setup(null);
    await lastValueFrom(plain.interceptor.intercept(plain.context, { handle: () => of(1) }));
    expect(plain.record).not.toHaveBeenCalled();

    const target = newUuidv7();
    const platform = setup({ action: 'platform.tenant.status', resourceType: 'tenant', scope: 'platform', idParam: 'id', tenantParam: 'id', valueFields: ['status'] });
    (platform.request.params as Record<string, string>).id = target;
    (platform.request.body as Record<string, unknown>) = { status: 'suspended', reason: 'private text' };
    await lastValueFrom(platform.interceptor.intercept(platform.context, { handle: () => of(1) }));
    const call = platform.record.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ scope: 'platform', tenantId: target, actorType: 'platform_admin', resourceId: target });
    expect(call.metadata).toEqual({ fields: 'status,reason', status: 'suspended' });
  });
});

describe('Audit read endpoints', () => {
  const list = jest.fn().mockResolvedValue({ items: [], nextBeforeId: null });
  const service = { list } as unknown as AuditService;
  beforeEach(() => list.mockClear());

  it('tenant endpoint is pinned to the verified tenant and rejects a tenantId query', async () => {
    const controller = new AuditController(service);
    const tenantId = newUuidv7();
    await controller.list({ tenantId } as never, { limit: '10', action: 'widget.key.rotate' });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ scope: 'tenant', tenantId, limit: 10, action: 'widget.key.rotate' }));
    expect(() => controller.list({ tenantId } as never, { tenantId: newUuidv7() })).toThrow(BadRequestException);
    expect(() => controller.list({ tenantId } as never, { limit: '1000' })).toThrow(BadRequestException);
    expect(() => controller.list({ tenantId } as never, { from: 'nonsense' })).toThrow(BadRequestException);
    expect(() => controller.list({ tenantId } as never, { action: "x'; DROP" })).toThrow(BadRequestException);
    expect(() => controller.list({ tenantId } as never, { beforeId: 'abc' })).toThrow(BadRequestException);
  });

  it('platform endpoint reads platform scope only and validates tenant filter', async () => {
    const controller = new PlatformAuditController(service);
    const tenantId = newUuidv7();
    await controller.list({ tenantId });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ scope: 'platform', tenantId }));
    expect(() => controller.list({ tenantId: 'x' })).toThrow(BadRequestException);
  });

  it('declares permission metadata: tenant route needs tenants:write, platform route is platform-only', () => {
    const reflect = (target: object, method: string, key: symbol | string) => Reflect.getMetadata(key, (target as Record<string, object>)[method]);
    const { REQUIRED_PERMISSIONS, AUTH_MODE } = jest.requireActual('../auth/auth.decorators') as typeof import('../auth/auth.decorators');
    expect(reflect(AuditController.prototype, 'list', REQUIRED_PERMISSIONS)).toEqual(['tenants:write']);
    expect(reflect(PlatformAuditController.prototype, 'list', AUTH_MODE)).toBe('platform');
  });
});

describe('migration 12', () => {
  it('is registered, creates audit_events with indexes and no secret-bearing columns, and drops it on down', async () => {
    expect(ALL_MIGRATIONS).toContain(AuditEvents1740000000012);
    const sql: string[] = [];
    const runner = { query: async (text: string) => { sql.push(text); } } as never;
    await new AuditEvents1740000000012().up(runner);
    const ddl = sql.join('\n');
    for (const index of ['idx_audit_tenant_created', 'idx_audit_tenant_action_created', 'idx_audit_actor_created', 'idx_audit_resource', 'idx_audit_scope_created']) {
      expect(ddl).toContain(index);
    }
    expect(ddl).not.toMatch(/FOREIGN KEY/i);
    expect(ddl).not.toMatch(/secret|token|cipher|audio|password/i);
    sql.length = 0;
    await new AuditEvents1740000000012().down(runner);
    expect(sql[0]).toContain('DROP TABLE IF EXISTS `audit_events`');
  });
});
