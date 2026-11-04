import { Injectable, ConflictException, ForbiddenException, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AuthStore } from '../../auth/auth-store.service';
import { live } from '../../auth/auth.service';
import { TokenService } from '../../auth/token.service';
import { RateLimitService } from '../../auth/rate-limit.service';
import { attachContext, REQUEST_ID, type AuthenticatedRequest, type AuthenticatedUser } from '../../auth/auth-context';
import { AUTH_MODE, AUTH_RATE_POLICY, DEV_HEADER_ALLOWED, REQUIRED_PERMISSIONS, type AuthMode, type AuthRatePolicy } from '../../auth/auth.decorators';
import { TenantContextService } from '../../agent/context/tenant-context.service';
import type { TenantContext } from './tenant-context.store';

/** Global, fail-closed authentication + DB-backed authorization. Default: tenant required. */
@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService,
    private readonly store: AuthStore, private readonly rate: RateLimitService,
    private readonly legacyContext: TenantContextService) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const http = execution.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const requestId = randomUUID();
    Object.defineProperty(request, REQUEST_ID, { value: requestId });
    response.setHeader('X-Request-Id', requestId);
    // Auth responses never enter a shared/browser cache, including failures.
    response.setHeader('Cache-Control', 'no-store');
    const targets = [execution.getHandler(), execution.getClass()];
    const mode = this.reflector.getAllAndOverride<AuthMode>(AUTH_MODE, targets) ?? 'tenant';
    const required = this.reflector.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    const policy = this.reflector.getAllAndOverride<AuthRatePolicy>(AUTH_RATE_POLICY, targets);
    this.rate.checkRequest(request, response, policy);
    if (mode === 'public') {
      if (required.length) throw new Error('A public route cannot require permissions.');
      return true;
    }
    if (!['identity', 'tenant', 'platform'].includes(mode)) throw unauthorized();

    const authorization = request.headers.authorization;
    if (authorization === undefined && mode === 'tenant' && this.reflector.getAllAndOverride<boolean>(DEV_HEADER_ALLOWED, targets)) {
      const legacy = this.legacyContext.resolveDevelopment(request.headers, request.socket.remoteAddress, requestId);
      const tenant: TenantContext = { ...legacy, actorType: 'system' };
      this.checkPermissions(required, tenant.permissions);
      this.rate.checkContext(response, undefined, tenant);
      attachContext(request, undefined, tenant);
      return true;
    }
    if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._-]{1,2048}$/i.test(authorization)) throw unauthorized();
    const result = this.tokens.verify(authorization.slice(7));
    if (!result.ok) throw unauthorized();
    const claims = result.claims;
    const user = await this.store.findUserById(claims.userId);
    const session = await this.store.findSession(claims.sessionId);
    if (!session || !live(user, session)) throw unauthorized();
    if (claims.tenantId !== session.activeTenantId) throw new ConflictException('The access token is stale. Refresh it and retry.');
    let identity: AuthenticatedUser = { userId: user.id, sessionId: session.id, activeTenantId: session.activeTenantId };
    let tenant: TenantContext | undefined;
    if (mode === 'tenant') {
      if (!session.activeTenantId) throw unauthorized();
      const membership = await this.store.findMembership(user.id, session.activeTenantId);
      if (membership?.status !== 'active') throw unauthorized();
      if ((await this.store.findTenant(session.activeTenantId))?.status !== 'active') throw new ForbiddenException('Tenant access is unavailable.');
      tenant = { tenantId: session.activeTenantId, actorType: 'user', userId: user.id,
        permissions: await this.store.rolePermissions(membership.roleId), requestId };
      this.checkPermissions(required, tenant.permissions);
    } else if (mode === 'platform') {
      const roleId = await this.store.platformRole(user.id);
      if (roleId === undefined) throw new ForbiddenException('Permission denied.');
      this.checkPermissions(required, await this.store.rolePermissions(roleId));
      identity = { ...identity, platformRole: 'platform:admin' };
      // Deliberately no tenant ALS context; staff cannot bypass tenant repositories.
    } else if (required.length) {
      // A permission-bearing handler cannot silently opt out of tenant checks.
      throw new Error('An identity-only route cannot require tenant permissions.');
    }
    this.rate.checkContext(response, identity, tenant);
    await this.store.touchSession(user.id, session.id);
    attachContext(request, identity, tenant);
    return true;
  }

  private checkPermissions(required: readonly string[], granted: readonly string[]): void {
    if (!required.every((permission) => granted.includes(permission))) throw new ForbiddenException('Permission denied.');
  }
}

function unauthorized(): UnauthorizedException { return new UnauthorizedException('Authentication required.'); }
