import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ToolErrorCode } from './interfaces/tool-execution-result.interface';
import { TOOL_AUDIT_SINK, type ToolAuditSink } from '../../conversations/conversations.repository';

/** Outcome recorded for one execution attempt. */
export type ToolAuditOutcome =
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'timed_out';

/**
 * One audit entry. SECURITY: audit records deliberately contain NO tool
 * arguments, results, credentials, or error details — only safe metadata and
 * the structured error code.
 */
export interface ToolAuditRecord {
  tenantId: string;
  toolName: string;
  requestId: string;
  /** ISO-8601 timestamp of when the execution attempt started. */
  executedAt: string;
  durationMs: number;
  outcome: ToolAuditOutcome;
  /** Structured error code; null on success. */
  errorCode: ToolErrorCode | null;
  assistantId?: string;
  conversationId?: string;
  userId?: string;
  argumentsDigest?: string;
  argumentsSize?: number;
  argumentsSummary?: { keys: string[] };
  resultSummary?: Record<string, number | boolean>;
}

/** Upper bound for the in-memory audit buffer (oldest entries dropped). */
const MAX_AUDIT_RECORDS = 1_000;

/**
 * The bounded memory trail remains available for diagnostics; durable writes
 * are deliberately asynchronous and failure-isolated from tool responses.
 */
@Injectable()
export class ToolAuditService {
  private readonly logger = new Logger(ToolAuditService.name);
  private readonly records: ToolAuditRecord[] = [];
  private readonly pending = new Set<Promise<void>>();

  constructor(@Optional() @Inject(TOOL_AUDIT_SINK) private readonly sink?: ToolAuditSink) {}

  record(entry: ToolAuditRecord): Promise<void> {
    const snapshot = { ...entry, argumentsSummary: entry.argumentsSummary ? { keys: [...entry.argumentsSummary.keys] } : undefined,
      resultSummary: entry.resultSummary ? { ...entry.resultSummary } : undefined };
    this.records.push(snapshot);

    if (this.records.length > MAX_AUDIT_RECORDS) {
      this.records.splice(0, this.records.length - MAX_AUDIT_RECORDS);
    }
    if (!this.sink) return Promise.resolve();
    const operation = Promise.resolve()
      .then(() => this.sink!.persistToolAudit(snapshot))
      .catch(() => {
        this.logger.warn(JSON.stringify({
          event: 'tool_audit_persistence_failed',
          requestId: snapshot.requestId,
          toolName: snapshot.toolName,
        }));
      })
      .finally(() => this.pending.delete(operation));
    this.pending.add(operation);
    return operation;
  }

  /** Read-only snapshot of the audit trail (used by tests and diagnostics). */
  list(): readonly ToolAuditRecord[] {
    return [...this.records];
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}
