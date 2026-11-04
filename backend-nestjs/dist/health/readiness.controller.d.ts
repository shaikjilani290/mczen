import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { type SharedState } from '../shared-state/shared-state';
export declare class ReadinessController {
    private readonly source;
    private readonly store;
    private readonly audit;
    constructor(source: DataSource | undefined, store: SharedState, audit: AuditService);
    ready(response: Response): Promise<{
        status: string;
        checks: {
            database: string;
            auditSchema: string;
            sharedState: string;
        };
        sharedStateDriver: "memory" | "redis";
        auditWriteFailures: number;
    }>;
}
