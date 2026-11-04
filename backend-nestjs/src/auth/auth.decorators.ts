import { applyDecorators, createParamDecorator, SetMetadata, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { AUTH_CONTEXT, type AuthenticatedRequest } from './auth-context';
import { tenantContextStore } from '../common/tenant/tenant-context.store';

export const AUTH_MODE = Symbol('MCZEN_AUTH_MODE');
export const REQUIRED_PERMISSIONS = Symbol('MCZEN_REQUIRED_PERMISSIONS');
export const DEV_HEADER_ALLOWED = Symbol('MCZEN_DEV_HEADER_ALLOWED');
export const AUTH_RATE_POLICY = Symbol('MCZEN_AUTH_RATE_POLICY');
export type AuthMode = 'public' | 'identity' | 'tenant' | 'platform';
export type AuthRatePolicy = 'register' | 'login' | 'refresh' | 'forgot' | 'reset' | 'verify';

export const PublicRoute = () => SetMetadata(AUTH_MODE, 'public' satisfies AuthMode);
/** Live user/session required; permits selection, logout and profile without usable tenancy. */
export const IdentityOnly = () => SetMetadata(AUTH_MODE, 'identity' satisfies AuthMode);
export const RequirePermission = (...permissions: string[]) => SetMetadata(REQUIRED_PERMISSIONS, Object.freeze([...permissions]));
/** Reserved DB-assigned staff role only. Never grants an implicit tenant bypass. */
export const RequirePlatform = (...permissions: string[]) => applyDecorators(
  SetMetadata(AUTH_MODE, 'platform' satisfies AuthMode), RequirePermission(...permissions),
);
/** Opt-in is limited to the two legacy agent routes, not global impersonation. */
export const AllowDevHeader = () => SetMetadata(DEV_HEADER_ALLOWED, true);
export const AuthRateLimit = (policy: AuthRatePolicy) => SetMetadata(AUTH_RATE_POLICY, policy);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>()[AUTH_CONTEXT];
  if (!user) throw new UnauthorizedException('Authentication required.');
  return user;
});

/** Read the verified ALS snapshot, never a raw request tenant field. */
export const CurrentTenant = createParamDecorator(() => tenantContextStore.getOrThrow());
