import { ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { TenantAuthGuard } from './tenant-context.guard';
import { AuthStore, type SessionRow, type UserRow } from '../../auth/auth-store.service';
import { AUTH_CONTEXT, TENANT_CONTEXT, type AuthenticatedRequest } from '../../auth/auth-context';
import { AllowDevHeader, IdentityOnly, PublicRoute, RequirePermission, RequirePlatform } from '../../auth/auth.decorators';
import { TokenService } from '../../auth/token.service';
import { RateLimitService } from '../../auth/rate-limit.service';
import { TenantContextService } from '../../agent/context/tenant-context.service';
import { newUuidv7 } from '../ids/uuid';

class Routes {
  tenant() {}
  @IdentityOnly() identity() {}
  @PublicRoute() public() {}
  @RequirePermission('users:manage') manage() {}
  @RequirePlatform() platform() {}
  @RequirePlatform('platform:write') platformWrite() {}
  @AllowDevHeader() demo() {}
}
@RequirePermission('knowledge:read')
class Combined { @RequirePermission('users:manage') handler() {} }
@RequirePermission('knowledge:read')
class UnsafePublic { @PublicRoute() handler() {} }

describe('TenantAuthGuard (global fail-closed pipeline)', () => {
  const tokens = new TokenService({ env: { JWT_SECRET: 'guard-test-only-key-at-least-32-bytes' } });
  const original = { node: process.env.NODE_ENV, flag: process.env.MCZEN_ALLOW_DEV_HEADER };
  let user: UserRow;
  let session: SessionRow;
  let store: Record<string, jest.Mock>;
  let guard: TenantAuthGuard;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.MCZEN_ALLOW_DEV_HEADER = '1';
    user = { id: newUuidv7(), email: 'private@example.test', passwordHash: 'secret-digest', status: 'active', emailVerifiedAt: null, failedLoginCount: 0,
      lockedUntil: null, displayName: null, tokenVersion: 1, loginFailureWindowStartedAt: null };
    session = { id: newUuidv7(), userId: user.id, activeTenantId: newUuidv7(), expiresAt: new Date(Date.now() + 86_400_000), revokedAt: null, tokenVersion: 1 };
    store = {
      findUserById: jest.fn().mockResolvedValue(user), findSession: jest.fn().mockResolvedValue(session),
      findMembership: jest.fn().mockResolvedValue({ status: 'active', roleId: 1, roleKey: 'tenant:owner', roleIsPlatform: false }),
      findTenant: jest.fn().mockResolvedValue({ id: session.activeTenantId, status: 'active' }),
      rolePermissions: jest.fn().mockResolvedValue(['knowledge:read']), platformRole: jest.fn().mockResolvedValue(undefined),
      touchSession: jest.fn().mockResolvedValue(undefined),
    };
    guard = new TenantAuthGuard(new Reflector(), tokens, store as unknown as AuthStore, new RateLimitService({ env: {} }), new TenantContextService());
  });
  afterAll(() => {
    if (original.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.node;
    if (original.flag === undefined) delete process.env.MCZEN_ALLOW_DEV_HEADER; else process.env.MCZEN_ALLOW_DEV_HEADER = original.flag;
  });
  function token(): string { return tokens.sign({ userId: user.id, sessionId: session.id, tenantId: session.activeTenantId }); }
  function execution(method = 'tenant', authorization: string | undefined = `Bearer ${token()}`, klass: Function = Routes) {
    const request = { headers: { ...(authorization === undefined ? {} : { authorization }) }, socket: { remoteAddress: '127.0.0.1' }, body: {}, query: {} } as AuthenticatedRequest;
    const response = { setHeader: jest.fn() } as unknown as Response;
    const context = { getHandler: () => klass.prototype[method], getClass: () => klass,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ExecutionContext;
    return { request, response, context };
  }
  it('defaults unannotated routes to authenticated tenant access', async () => {
    const { request, context } = execution();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(store.findMembership).toHaveBeenCalledWith(user.id, session.activeTenantId);
    expect(request[TENANT_CONTEXT]).toMatchObject({ tenantId: session.activeTenantId, userId: user.id, actorType: 'user', permissions: ['knowledge:read'] });
    expect(request[AUTH_CONTEXT]).not.toHaveProperty('email');
    expect(request[AUTH_CONTEXT]).not.toHaveProperty('passwordHash');
    expect(Object.isFrozen(request[TENANT_CONTEXT]?.permissions)).toBe(true);
    expect(() => Object.defineProperty(request, AUTH_CONTEXT, { value: { userId: 'foreign' } })).toThrow();
  });
  it('permits only explicitly public routes without touching the database', async () => {
    const { context } = execution('public', undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(store.findUserById).not.toHaveBeenCalled();
  });
  it.each([undefined, 'Bearer bad-token', 'Basic credentials', 'Bearer wgt_secret', 'Bearer a.b.c'])('maps missing/invalid credentials to the same generic 401: %s', async (authorization) => {
    const { context } = execution('tenant', authorization);
    // Explicit undefined must not activate the helper's default argument.
    if (authorization === undefined) delete (context.switchToHttp().getRequest() as AuthenticatedRequest).headers.authorization;
    await expect(guard.canActivate(context)).rejects.toThrow(new UnauthorizedException('Authentication required.'));
  });
  it.each(['disabled', 'erased'])('immediately rejects a %s DB user', async (status) => {
    user.status = status as UserRow['status'];
    await expect(guard.canActivate(execution().context)).rejects.toThrow(UnauthorizedException);
    expect(store.findMembership).not.toHaveBeenCalled();
  });
  it('rejects revoked, expired, foreign-user and token-version-invalid sessions', async () => {
    const good = { ...session };
    for (const changes of [{ revokedAt: new Date() }, { expiresAt: new Date(Date.now() - 1) }, { userId: newUuidv7() }, { tokenVersion: 2 }]) {
      Object.assign(session, good, changes);
      await expect(guard.canActivate(execution().context)).rejects.toThrow(UnauthorizedException);
    }
  });
  it('rejects a stale tenant hint after a server-side session switch', async () => {
    const oldToken = token();
    session.activeTenantId = newUuidv7();
    await expect(guard.canActivate(execution('tenant', `Bearer ${oldToken}`).context)).rejects.toThrow(ConflictException);
    await expect(guard.canActivate(execution('identity', `Bearer ${oldToken}`).context)).rejects.toThrow(ConflictException);
  });
  it('allows identity-only endpoints without creating tenant context', async () => {
    session.activeTenantId = null;
    const { context, request } = execution('identity');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request[AUTH_CONTEXT]).toHaveProperty('activeTenantId', null);
    expect(request[TENANT_CONTEXT]).toBeUndefined();
    await expect(guard.canActivate(execution().context)).rejects.toThrow(UnauthorizedException);
  });
  it.each([undefined, { status: 'invited' }, { status: 'suspended' }, { status: 'removed' }])('fails closed for missing/non-active membership: %p', async (membership) => {
    store.findMembership.mockResolvedValue(membership);
    await expect(guard.canActivate(execution().context)).rejects.toThrow(UnauthorizedException);
  });
  it.each(['suspended', 'closed'])('rejects a known %s tenant with neutral 403', async (status) => {
    store.findTenant.mockResolvedValue({ status });
    await expect(guard.canActivate(execution().context)).rejects.toThrow(new ForbiddenException('Tenant access is unavailable.'));
  });
  it('does not let raw tenant or permissions fields override the DB-backed context', async () => {
    const { request, context } = execution();
    request.headers['x-mczen-tenant-id'] = 'tenant-b';
    request.body = { tenantId: 'foreign', permissions: ['users:manage'], role: 'platform:admin' };
    request.query.tenantId = 'foreign';
    await guard.canActivate(context);
    expect(request[TENANT_CONTEXT]?.tenantId).toBe(session.activeTenantId);
    expect(request[TENANT_CONTEXT]?.permissions).toEqual(['knowledge:read']);
  });
  it('requires every exact permission and merges class/handler requirements', async () => {
    await expect(guard.canActivate(execution('manage').context)).rejects.toThrow(ForbiddenException);
    store.rolePermissions.mockResolvedValue(['users:manage']);
    await expect(guard.canActivate(execution('handler', `Bearer ${token()}`, Combined).context)).rejects.toThrow(ForbiddenException);
    store.rolePermissions.mockResolvedValue(['knowledge:read', 'users:manage']);
    await expect(guard.canActivate(execution('handler', `Bearer ${token()}`, Combined).context)).resolves.toBe(true);
    store.rolePermissions.mockResolvedValue(['*']);
    await expect(guard.canActivate(execution('manage').context)).rejects.toThrow(ForbiddenException);
  });
  it('resolves only an explicit platform DB role, never a tenant-admin wildcard or bypass', async () => {
    await expect(guard.canActivate(execution('platform').context)).rejects.toThrow(ForbiddenException);
    store.platformRole.mockResolvedValue(6);
    store.rolePermissions.mockResolvedValue([]);
    const { context, request } = execution('platform');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request[AUTH_CONTEXT]?.platformRole).toBe('platform:admin');
    expect(request[TENANT_CONTEXT]).toBeUndefined();
    await expect(guard.canActivate(execution('platformWrite').context)).rejects.toThrow(ForbiddenException);
  });
  it('uses the legacy exception only on explicitly allowed routes and never for invalid bearers', async () => {
    const demo = execution('demo');
    delete demo.request.headers.authorization;
    demo.request.headers['x-mczen-tenant-id'] = 'tenant-a';
    await expect(guard.canActivate(demo.context)).resolves.toBe(true);
    expect(demo.request[AUTH_CONTEXT]).toBeUndefined();
    const invalid = execution('demo', 'Bearer invalid');
    invalid.request.headers['x-mczen-tenant-id'] = 'tenant-a';
    await expect(guard.canActivate(invalid.context)).rejects.toThrow(UnauthorizedException);
    process.env.NODE_ENV = 'production';
    const production = execution('demo');
    delete production.request.headers.authorization;
    production.request.headers['x-mczen-tenant-id'] = 'tenant-a';
    await expect(guard.canActivate(production.context)).rejects.toThrow(UnauthorizedException);
  });
  it('fails closed when authentication storage is unavailable', async () => {
    store.findUserById.mockRejectedValue(new ServiceUnavailableException('Authentication service is unavailable.'));
    await expect(guard.canActivate(execution().context)).rejects.toThrow(ServiceUnavailableException);
  });
  it('fails closed for contradictory public/permission metadata', async () => {
    await expect(guard.canActivate(execution('handler', `Bearer ${token()}`, UnsafePublic).context)).rejects.toThrow();
  });
});
