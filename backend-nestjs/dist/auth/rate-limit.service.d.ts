import type { Response } from 'express';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth-context';
import type { AuthRatePolicy } from './auth.decorators';
import type { TenantContext } from '../common/tenant/tenant-context.store';
export declare class RateLimitConfigError extends Error {
}
export interface RateLimitOptions {
    env?: Record<string, string | undefined>;
    now?: () => number;
}
export declare class RateLimitService {
    private readonly buckets;
    private readonly now;
    private readonly ipLimit;
    private readonly sessionLimit;
    private readonly tenantLimit;
    private readonly maxKeys;
    private nextSweep;
    constructor(options?: RateLimitOptions);
    checkRequest(request: AuthenticatedRequest, response: Response, policy?: AuthRatePolicy): void;
    checkEdge(request: AuthenticatedRequest, response: Response): void;
    checkContext(response: Response, user?: AuthenticatedUser, tenant?: TenantContext): void;
    private consume;
    private deny;
}
