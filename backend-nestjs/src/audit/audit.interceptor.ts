import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUTH_CONTEXT, REQUEST_ID, TENANT_CONTEXT, type AuthenticatedRequest } from '../auth/auth-context';
import { isUuidv7 } from '../common/ids/uuid';
import { AuditService, type AuditOutcome } from './audit.service';

export const AUDITED = Symbol('MCZEN_AUDITED');

export interface AuditedOptions {
  action: string;
  resourceType: string;
  scope?: 'tenant' | 'platform';
  /** Route param holding the resource id. */
  idParam?: string;
  /** Route param whose value is the target tenant (platform actions). */
  tenantParam?: string;
  /** Route params copied into metadata (identifiers or enum-like names only). */
  paramFields?: readonly string[];
  /** Body fields whose values (short scalars, enum-like) may be recorded. Other body keys are recorded by name only. */
  valueFields?: readonly string[];
}

/** Records a durable audit event after the handler runs. Guards run first, so rejected requests are not recorded here. */
export const Audited = (options: AuditedOptions) => SetMetadata(AUDITED, options);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(AUDITED, context.getHandler());
    if (!options) return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { params?: Record<string, string>; body?: unknown }>();
    const write = (outcome: AuditOutcome) => { void this.write(options, request, outcome); };
    return next.handle().pipe(tap({
      next: () => write('success'),
      error: (error: unknown) => write(error instanceof HttpException && error.getStatus() === 403 ? 'denied' : 'failure'),
    }));
  }

  private write(options: AuditedOptions, request: AuthenticatedRequest & { params?: Record<string, string>; body?: unknown }, outcome: AuditOutcome): Promise<void> {
    const user = request[AUTH_CONTEXT];
    const tenant = request[TENANT_CONTEXT];
    const params = request.params ?? {};
    const scope = options.scope ?? 'tenant';
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
    const metadata: Record<string, unknown> = {};
    const keys = Object.keys(body);
    if (keys.length > 0) metadata.fields = keys.slice(0, 20).join(',');
    for (const field of options.valueFields ?? []) {
      if (typeof body[field] === 'string' || typeof body[field] === 'boolean' || typeof body[field] === 'number') metadata[field] = body[field];
    }
    for (const field of options.paramFields ?? []) if (params[field]) metadata[field] = params[field];
    const targetTenant = options.tenantParam ? params[options.tenantParam] : undefined;
    const tenantId = targetTenant !== undefined ? (isUuidv7(targetTenant) ? targetTenant : null) : (tenant?.tenantId ?? user?.activeTenantId ?? null);
    return this.audit.record({
      scope,
      tenantId,
      actorType: scope === 'platform' || user?.platformRole ? 'platform_admin' : 'user',
      actorId: user?.userId,
      action: options.action,
      resourceType: options.resourceType,
      resourceId: options.idParam ? params[options.idParam] : tenantId ?? undefined,
      outcome,
      requestId: request[REQUEST_ID] ?? tenant?.requestId,
      metadata,
    });
  }
}
