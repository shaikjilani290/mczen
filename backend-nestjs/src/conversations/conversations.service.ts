import { Injectable } from '@nestjs/common';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import type { AgentResponse } from '../agent/agent.service';
import type { AuthenticatedUser } from '../auth/auth-context';
import { tenantContextStore } from '../common/tenant/tenant-context.store';
import {
  type ConversationToolTrace,
  ConversationsRepository,
  type ToolAuditSink,
} from './conversations.repository';

@Injectable()
export class ConversationsService implements ToolAuditSink {
  constructor(private readonly repository: ConversationsRepository) {}

  create(input: Parameters<ConversationsRepository['create']>[0]) {
    return this.repository.create(input);
  }

  list(
    input: Parameters<ConversationsRepository['list']>[0],
  ) {
    return this.repository.list(input);
  }

  async get(id: string, user: AuthenticatedUser) {
    const row = await this.repository.find(id, user.userId, this.canManage());
    const messages = await this.repository.messages(id, 20, user.userId, this.canManage());
    return { ...this.mapRow(row), messages: messages.reverse().map(mapMessage) };
  }

  async update(
    id: string,
    input: Parameters<ConversationsRepository['update']>[1],
    user: AuthenticatedUser,
  ) {
    return this.mapRow(await this.repository.update(id, input, user.userId, this.canManage()));
  }

  async archive(id: string, user: AuthenticatedUser): Promise<void> {
    return this.repository.archive(id, user.userId, this.canManage());
  }

  async transcript(id: string, limit: number, user: AuthenticatedUser) {
    const rows = await this.repository.messages(id, limit, user.userId, this.canManage());
    return rows.reverse().map(mapMessage);
  }

  toolCalls(id: string, messageId: string, user: AuthenticatedUser) {
    return this.repository.toolCalls(id, messageId, user.userId, this.canManage());
  }

  prepareAgentTurn(id: string, context: AgentExecutionContext) {
    return this.repository.prepareAgentTurn(id, context);
  }

  persistTurn(
    context: AgentExecutionContext,
    question: string,
    response: AgentResponse,
    traces: readonly ConversationToolTrace[],
  ): Promise<void> {
    return this.repository.persistTurn(context, question, response, traces);
  }

  persistToolAudit(record: Parameters<ToolAuditSink['persistToolAudit']>[0]): Promise<void> {
    return this.repository.persistToolAudit(record);
  }

  private canManage(): boolean {
    return tenantContextStore.get()?.permissions.includes('conversations:manage') ?? false;
  }

  private mapRow(row: Record<string, unknown>) {
    return {
      id: binary(row.id),
      assistantId: binary(row.assistant_id),
      userId: row.user_id ? binary(row.user_id) : null,
      channel: row.channel,
      language: row.language_code,
      status: row.status,
      title: row.title,
      metadata: parseStoredJson(row.metadata),
      messageCount: Number(row.message_count),
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
    };
  }
}

function binary(value: unknown): string {
  if (!(value instanceof Uint8Array)) throw new TypeError('Expected a database UUID.');
  const hex = Buffer.from(value).toString('hex');
  if (hex.length !== 32) throw new TypeError('Expected a BINARY(16) UUID.');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mapMessage(row: Record<string, unknown>) {
  return {
    id: binary(row.public_id),
    role: row.role,
    content: row.content,
    status: row.status,
    language: row.language_code,
    modality: row.modality,
    model: row.model,
    sources: row.knowledge_sources_used,
    toolCallsCount: Number(row.tool_calls_count),
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
