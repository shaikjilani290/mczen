import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { binaryToUuid, uuidToBinary } from '../common/ids/uuid';
import { sanitizeMetadata } from './audit.sanitize';

export type AuditScope = 'tenant' | 'platform';
export type AuditActorType = 'user' | 'platform_admin' | 'widget' | 'system';
export type AuditOutcome = 'success' | 'denied' | 'failure';

export interface AuditRecordInput {
  scope: AuditScope;
  tenantId?: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome?: AuditOutcome;
  requestId?: string;
  metadata?: unknown;
}

export interface AuditQuery {
  scope: AuditScope;
  tenantId?: string;
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  beforeId?: string;
  limit: number;
}

export interface AuditEventView {
  id: string;
  scope: AuditScope;
  tenantId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: AuditOutcome;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const clip = (value: string | null | undefined, max: number): string | null => (value ? value.slice(0, max) : null);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private failures = 0;

  constructor(@Optional() @InjectDataSource() private readonly source?: DataSource) {}

  private get database(): DataSource {
    if (!this.source) throw new ServiceUnavailableException('Audit storage is unavailable.');
    return this.source;
  }

  /** Count of audit writes that failed since start (exposed to readiness; never includes content). */
  get failureCount(): number { return this.failures; }

  /** Never throws: an audit outage must not turn a completed business action into an error. */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      const metadata = sanitizeMetadata(input.metadata);
      await this.database.query(
        'INSERT INTO `audit_events` (`scope`,`tenant_id`,`actor_type`,`actor_id`,`action`,`resource_type`,`resource_id`,`outcome`,`request_id`,`metadata`) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [
          input.scope,
          input.tenantId ? uuidToBinary(input.tenantId) : null,
          input.actorType,
          clip(input.actorId, 64),
          input.action.slice(0, 80),
          clip(input.resourceType, 40),
          clip(input.resourceId, 64),
          input.outcome ?? 'success',
          clip(input.requestId, 64),
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
    } catch {
      this.failures += 1;
      this.logger.error(JSON.stringify({ event: 'audit.write_failed', action: input.action.slice(0, 80) }));
    }
  }

  async list(query: AuditQuery): Promise<{ items: AuditEventView[]; nextBeforeId: string | null }> {
    const where: string[] = ['`scope`=?'];
    const params: unknown[] = [query.scope];
    if (query.tenantId) { where.push('`tenant_id`=?'); params.push(uuidToBinary(query.tenantId)); }
    if (query.action) { where.push('`action`=?'); params.push(query.action); }
    if (query.actorId) { where.push('`actor_id`=?'); params.push(query.actorId); }
    if (query.from) { where.push('`created_at`>=?'); params.push(query.from); }
    if (query.to) { where.push('`created_at`<?'); params.push(query.to); }
    if (query.beforeId) { where.push('`id`<?'); params.push(query.beforeId); }
    const limit = Math.min(Math.max(query.limit, 1), 100);
    const rows = await this.database.query(
      `SELECT * FROM \`audit_events\` WHERE ${where.join(' AND ')} ORDER BY \`id\` DESC LIMIT ${limit + 1}`,
      params,
    ) as Array<Record<string, unknown>>;
    const page = rows.slice(0, limit).map(toView);
    return { items: page, nextBeforeId: rows.length > limit ? page[page.length - 1].id : null };
  }
}

function toView(row: Record<string, unknown>): AuditEventView {
  const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) as Record<string, unknown> : (row.metadata as Record<string, unknown> | null);
  return {
    id: String(row.id),
    scope: row.scope as AuditScope,
    tenantId: row.tenant_id ? binaryToUuid(row.tenant_id as Buffer) : null,
    actorType: row.actor_type as AuditActorType,
    actorId: (row.actor_id as string | null) ?? null,
    action: String(row.action),
    resourceType: (row.resource_type as string | null) ?? null,
    resourceId: (row.resource_id as string | null) ?? null,
    outcome: row.outcome as AuditOutcome,
    requestId: (row.request_id as string | null) ?? null,
    metadata: metadata ?? null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}
