import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthStore } from '../../auth/auth-store.service';
import { TokenService } from '../../auth/token.service';
import { RateLimitService } from '../../auth/rate-limit.service';
import { TenantContextService } from '../../agent/context/tenant-context.service';
export declare class TenantAuthGuard implements CanActivate {
    private readonly reflector;
    private readonly tokens;
    private readonly store;
    private readonly rate;
    private readonly legacyContext;
    constructor(reflector: Reflector, tokens: TokenService, store: AuthStore, rate: RateLimitService, legacyContext: TenantContextService);
    canActivate(execution: ExecutionContext): Promise<boolean>;
    private checkPermissions;
}
