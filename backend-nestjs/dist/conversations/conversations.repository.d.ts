import { DataSource, EntityManager, ObjectLiteral } from 'typeorm';
import { TenantScopedRepository } from '../common/tenant/tenant-scoped.repository';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import type { AgentResponse } from '../agent/agent.service';
import type { ToolAuditRecord } from '../agent/tools/tool-audit.service';
type Row = Record<string, unknown>;
export interface ConversationToolTrace {
    name: string;
    round: number;
    sequence: number;
    arguments: Record<string, unknown>;
    outcome: ToolAuditRecord['outcome'];
    errorCode: string | null;
    durationMs: number;
    resultSummary: Record<string, unknown> | null;
}
export declare class ConversationsRepository extends TenantScopedRepository<ObjectLiteral> {
    private readonly source;
    constructor(source: DataSource);
    private tenantBinary;
    private run;
    create(input: {
        assistantId: string;
        userId: string;
        title: string | null;
        channel: string;
        language: string | null;
        metadata: Record<string, string | number | boolean | string[]> | null;
    }): Promise<string>;
    list(input: {
        page: number;
        pageSize: number;
        status?: string;
        assistantId?: string;
        q?: string;
        sortBy: 'lastMessageAt' | 'createdAt' | 'updatedAt';
        sortOrder: 'asc' | 'desc';
        userId: string;
        elevated: boolean;
    }): Promise<{
        items: {
            id: string;
            assistantId: string;
            userId: string | null;
            channel: unknown;
            language: unknown;
            status: unknown;
            title: unknown;
            metadata: unknown;
            messageCount: number;
            lastMessageAt: unknown;
            createdAt: unknown;
            updatedAt: unknown;
        }[];
        page: number;
        pageSize: number;
        total: number;
    }>;
    find(id: string, userId?: string, elevated?: boolean, manager?: EntityManager, widget?: boolean): Promise<Row>;
    update(id: string, input: {
        title?: string | null;
        language?: string | null;
        metadata?: Record<string, string | number | boolean | string[]> | null;
    }, userId: string, elevated: boolean): Promise<Row>;
    archive(id: string, userId: string, elevated: boolean): Promise<void>;
    messages(id: string, limit: number, userId: string, elevated: boolean): Promise<Row[]>;
    toolCalls(id: string, messageId: string, userId: string, elevated: boolean): Promise<Row[]>;
    prepareAgentTurn(id: string, context: AgentExecutionContext): Promise<{
        assistantId: string;
        history: Array<{
            role: 'user' | 'assistant';
            content: string;
        }>;
    }>;
    persistTurn(context: AgentExecutionContext, question: string, response: AgentResponse, traces: readonly ConversationToolTrace[]): Promise<void>;
    persistToolAudit(record: ToolAuditRecord): Promise<void>;
    private insertMessage;
}
export declare const TOOL_AUDIT_SINK: unique symbol;
export interface ToolAuditSink {
    persistToolAudit(record: ToolAuditRecord): Promise<void>;
}
export {};
