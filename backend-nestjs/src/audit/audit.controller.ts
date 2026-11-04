import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RequirePermission, RequirePlatform } from '../auth/auth.decorators';
import { CurrentTenant } from '../auth/auth.decorators';
import type { TenantContext } from '../common/tenant/tenant-context.store';
import { isUuidv7 } from '../common/ids/uuid';
import { AuditService, type AuditQuery } from './audit.service';

const ACTION = /^[a-z][a-z0-9_.]{0,79}$/;

function parseQuery(query: Record<string, unknown>): Omit<AuditQuery, 'scope' | 'tenantId'> {
  const allowed = new Set(['action', 'actorId', 'from', 'to', 'beforeId', 'limit', 'tenantId']);
  for (const key of Object.keys(query)) if (!allowed.has(key)) throw new BadRequestException(`Unknown query parameter: ${key.slice(0, 40)}.`);
  const out: Omit<AuditQuery, 'scope' | 'tenantId'> = { limit: 50 };
  if (query.action !== undefined) {
    if (typeof query.action !== 'string' || !ACTION.test(query.action)) throw new BadRequestException('action is invalid.');
    out.action = query.action;
  }
  if (query.actorId !== undefined) {
    if (typeof query.actorId !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(query.actorId)) throw new BadRequestException('actorId is invalid.');
    out.actorId = query.actorId;
  }
  for (const field of ['from', 'to'] as const) {
    const value = query[field];
    if (value === undefined) continue;
    const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be an ISO date.`);
    out[field] = date;
  }
  if (query.beforeId !== undefined) {
    if (typeof query.beforeId !== 'string' || !/^\d{1,19}$/.test(query.beforeId)) throw new BadRequestException('beforeId is invalid.');
    out.beforeId = query.beforeId;
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be 1-100.');
    out.limit = limit;
  }
  return out;
}

/** Tenant admins read only their own tenant's events; the tenant comes from the verified context, never the query. */
@Controller('api/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('tenants:write')
  list(@CurrentTenant() tenant: TenantContext, @Query() query: Record<string, unknown>) {
    if ('tenantId' in query) throw new BadRequestException('Unknown query parameter: tenantId.');
    return this.audit.list({ ...parseQuery(query), scope: 'tenant', tenantId: tenant.tenantId });
  }
}

/** Platform staff only. */
@Controller('api/platform/audit')
export class PlatformAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePlatform()
  list(@Query() query: Record<string, unknown>) {
    const parsed = parseQuery(query);
    const tenantId = query.tenantId;
    if (tenantId !== undefined && !isUuidv7(tenantId)) throw new BadRequestException('tenantId is invalid.');
    return this.audit.list({ ...parsed, scope: 'platform', ...(tenantId ? { tenantId: tenantId as string } : {}) });
  }
}
