import type { Request } from 'express';
import type { TenantContext } from '../common/tenant/tenant-context.store';

/** Symbols cannot be populated by JSON, query strings, or HTTP headers. */
export const AUTH_CONTEXT = Symbol('MCZEN_AUTH_CONTEXT');
export const TENANT_CONTEXT = Symbol('MCZEN_TENANT_CONTEXT');
export const REQUEST_ID = Symbol('MCZEN_REQUEST_ID');

export interface AuthenticatedUser {
  readonly userId: string;
  readonly sessionId: string;
  readonly activeTenantId: string | null;
  readonly platformRole?: 'platform:admin';
}

export interface AuthenticatedRequest extends Request {
  readonly [AUTH_CONTEXT]?: AuthenticatedUser;
  readonly [TENANT_CONTEXT]?: TenantContext;
  readonly [REQUEST_ID]?: string;
}

/** The guard is the only caller; snapshots are immutable and non-enumerable. */
export function attachContext(request: AuthenticatedRequest, user?: AuthenticatedUser, tenant?: TenantContext): void {
  if (user) Object.defineProperty(request, AUTH_CONTEXT, { value: Object.freeze({ ...user }) });
  if (tenant) Object.defineProperty(request, TENANT_CONTEXT, {
    value: Object.freeze({ ...tenant, permissions: Object.freeze([...tenant.permissions]) }),
  });
}
