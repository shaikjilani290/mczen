import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { tenantContextStore } from './tenant-context.store';
import { attachContext, TENANT_CONTEXT, type AuthenticatedRequest } from '../../auth/auth-context';

function execution(request: AuthenticatedRequest): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}
const tenant = { tenantId: 'verified-tenant', actorType: 'user' as const, userId: 'verified-user', permissions: ['knowledge:read'], requestId: 'req-test' };

describe('TenantContextInterceptor (actual RxJS subscription scope)', () => {
  it('establishes immutable ALS scope at subscription, callbacks and teardown', () => {
    const request = {} as AuthenticatedRequest;
    attachContext(request, undefined, tenant);
    let emit: () => void = () => {};
    let teardownTenant: string | undefined;
    const next: CallHandler = { handle: () => {
      expect(tenantContextStore.getOrThrow().tenantId).toBe(tenant.tenantId);
      return new Observable((subscriber) => {
        emit = () => subscriber.next('value');
        return () => { teardownTenant = tenantContextStore.getOrThrow().tenantId; };
      });
    } };
    const stream = new TenantContextInterceptor().intercept(execution(request), next);
    const seen: string[] = [];
    const subscription = stream.subscribe(() => seen.push(tenantContextStore.getOrThrow().tenantId));
    expect(tenantContextStore.get()).toBeUndefined();
    emit(); // callback invoked from OUTSIDE any ALS scope
    expect(seen).toEqual([tenant.tenantId]);
    expect(tenantContextStore.get()).toBeUndefined();
    subscription.unsubscribe();
    expect(teardownTenant).toBe(tenant.tenantId);
    expect(Object.isFrozen(request[TENANT_CONTEXT]?.permissions)).toBe(true);
    expect(tenantContextStore.get()).toBeUndefined();
  });
  it('keeps error callbacks scoped without leaking context afterwards', () => {
    const request = {} as AuthenticatedRequest;
    attachContext(request, undefined, tenant);
    let errorTenant: string | undefined;
    new TenantContextInterceptor().intercept(execution(request), { handle: () => throwError(() => new Error('test')) })
      .subscribe({ error: () => { errorTenant = tenantContextStore.getOrThrow().tenantId; } });
    expect(errorTenant).toBe(tenant.tenantId);
    expect(tenantContextStore.get()).toBeUndefined();
  });
  it('does not invent tenancy on public or identity-only handlers', () => {
    const request = {} as AuthenticatedRequest;
    const seen: unknown[] = [];
    new TenantContextInterceptor().intercept(execution(request), { handle: () => of('value') })
      .subscribe(() => seen.push(tenantContextStore.get()));
    expect(seen).toEqual([undefined]);
  });
});
