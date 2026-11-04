import { DataSource } from 'typeorm';
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
export declare class AuditService {
    private readonly source?;
    private readonly logger;
    private failures;
    constructor(source?: DataSource | undefined);
    private get database();
    get failureCount(): number;
    record(input: AuditRecordInput): Promise<void>;
    list(query: AuditQuery): Promise<{
        items: AuditEventView[];
        nextBeforeId: string | null;
    }>;
}
