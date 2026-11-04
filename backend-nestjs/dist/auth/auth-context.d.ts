import type { Request } from 'express';
import type { TenantContext } from '../common/tenant/tenant-context.store';
export declare const AUTH_CONTEXT: unique symbol;
export declare const TENANT_CONTEXT: unique symbol;
export declare const REQUEST_ID: unique symbol;
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
export declare function attachContext(request: AuthenticatedRequest, user?: AuthenticatedUser, tenant?: TenantContext): void;
