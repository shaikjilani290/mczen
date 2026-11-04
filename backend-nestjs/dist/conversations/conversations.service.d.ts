import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import type { AgentResponse } from '../agent/agent.service';
import type { AuthenticatedUser } from '../auth/auth-context';
import { type ConversationToolTrace, ConversationsRepository, type ToolAuditSink } from './conversations.repository';
export declare class ConversationsService implements ToolAuditSink {
    private readonly repository;
    constructor(repository: ConversationsRepository);
    create(input: Parameters<ConversationsRepository['create']>[0]): Promise<string>;
    list(input: Parameters<ConversationsRepository['list']>[0]): Promise<{
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
    get(id: string, user: AuthenticatedUser): Promise<{
        messages: {
            id: string;
            role: unknown;
            content: unknown;
            status: unknown;
            language: unknown;
            modality: unknown;
            model: unknown;
            sources: unknown;
            toolCallsCount: number;
            errorCode: unknown;
            createdAt: unknown;
        }[];
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
        closedAt: unknown;
    }>;
    update(id: string, input: Parameters<ConversationsRepository['update']>[1], user: AuthenticatedUser): Promise<{
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
        closedAt: unknown;
    }>;
    archive(id: string, user: AuthenticatedUser): Promise<void>;
    transcript(id: string, limit: number, user: AuthenticatedUser): Promise<{
        id: string;
        role: unknown;
        content: unknown;
        status: unknown;
        language: unknown;
        modality: unknown;
        model: unknown;
        sources: unknown;
        toolCallsCount: number;
        errorCode: unknown;
        createdAt: unknown;
    }[]>;
    toolCalls(id: string, messageId: string, user: AuthenticatedUser): Promise<{
        [x: string]: unknown;
    }[]>;
    prepareAgentTurn(id: string, context: AgentExecutionContext): Promise<{
        assistantId: string;
        history: Array<{
            role: "user" | "assistant";
            content: string;
        }>;
    }>;
    persistTurn(context: AgentExecutionContext, question: string, response: AgentResponse, traces: readonly ConversationToolTrace[]): Promise<void>;
    persistToolAudit(record: Parameters<ToolAuditSink['persistToolAudit']>[0]): Promise<void>;
    private canManage;
    private mapRow;
}
