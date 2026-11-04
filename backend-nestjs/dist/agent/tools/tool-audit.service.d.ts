import { ToolErrorCode } from './interfaces/tool-execution-result.interface';
import { type ToolAuditSink } from '../../conversations/conversations.repository';
export type ToolAuditOutcome = 'succeeded' | 'rejected' | 'failed' | 'timed_out';
export interface ToolAuditRecord {
    tenantId: string;
    toolName: string;
    requestId: string;
    executedAt: string;
    durationMs: number;
    outcome: ToolAuditOutcome;
    errorCode: ToolErrorCode | null;
    assistantId?: string;
    conversationId?: string;
    userId?: string;
    argumentsDigest?: string;
    argumentsSize?: number;
    argumentsSummary?: {
        keys: string[];
    };
    resultSummary?: Record<string, number | boolean>;
}
export declare class ToolAuditService {
    private readonly sink?;
    private readonly logger;
    private readonly records;
    private readonly pending;
    constructor(sink?: ToolAuditSink | undefined);
    record(entry: ToolAuditRecord): Promise<void>;
    list(): readonly ToolAuditRecord[];
    flush(): Promise<void>;
}
