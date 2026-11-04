import type { TenantContext } from '../common/tenant/tenant-context.store';
import { AuditService } from './audit.service';
export declare class AuditController {
    private readonly audit;
    constructor(audit: AuditService);
    list(tenant: TenantContext, query: Record<string, unknown>): Promise<{
        items: import("./audit.service").AuditEventView[];
        nextBeforeId: string | null;
    }>;
}
export declare class PlatformAuditController {
    private readonly audit;
    constructor(audit: AuditService);
    list(query: Record<string, unknown>): Promise<{
        items: import("./audit.service").AuditEventView[];
        nextBeforeId: string | null;
    }>;
}
