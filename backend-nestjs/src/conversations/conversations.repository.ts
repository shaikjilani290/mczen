import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, ObjectLiteral } from 'typeorm';
import { binaryToUuid, isUuidv7, newUuidv7, uuidToBinary } from '../common/ids/uuid';
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

@Injectable()
export class ConversationsRepository extends TenantScopedRepository<ObjectLiteral> {
  constructor(@InjectDataSource() private readonly source: DataSource) {
    super(source.getRepository('conversations'));
  }

  private tenantBinary(): Buffer { return uuidToBinary(this.currentTenantId()); }

  private async run(sql: string, params: unknown[] = [], manager?: EntityManager): Promise<Row[]> {
    return (manager ?? this.source).query(sql, params) as Promise<Row[]>;
  }

  async create(input: {
    assistantId: string; userId: string; title: string | null; channel: string; language: string | null;
    metadata: Record<string, string | number | boolean | string[]> | null;
  }): Promise<string> {
    const tenant = this.tenantBinary();
    const assistant = uuidToBinary(input.assistantId);
    const owner = uuidToBinary(input.userId);
    const check = await this.run(
      `SELECT \`id\` FROM \`assistants\` WHERE \`id\`=? AND \`tenant_id\`=?
       AND \`status\`='active' AND \`deleted_at\` IS NULL`,
      [assistant, tenant],
    );
    if (!check[0]) throw new NotFoundException('Assistant not found.');
    const id = newUuidv7();
    await this.source.query(
      `INSERT INTO \`conversations\` (\`id\`,\`tenant_id\`,\`assistant_id\`,\`user_id\`,\`title\`,\`metadata\`,\`channel\`,\`language_code\`)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuidToBinary(id), tenant, assistant, owner, input.title, input.metadata ? JSON.stringify(input.metadata) : null, input.channel, input.language],
    );
    return id;
  }

  async list(input: {
    page: number; pageSize: number; status?: string; assistantId?: string; q?: string;
    sortBy: 'lastMessageAt' | 'createdAt' | 'updatedAt'; sortOrder: 'asc' | 'desc';
    userId: string; elevated: boolean;
  }) {
    const tenant = this.tenantBinary();
    const where = ['c.`tenant_id`=?', 'c.`deleted_at` IS NULL'];
    const params: unknown[] = [tenant];
    if (!input.elevated) {
      where.push('c.`user_id`=?');
      params.push(uuidToBinary(input.userId));
    }
    if (input.status) { where.push('c.`status`=?'); params.push(input.status); }
    if (input.assistantId) { where.push('c.`assistant_id`=?'); params.push(uuidToBinary(input.assistantId)); }
    if (input.q) { where.push('c.`title` LIKE ?'); params.push(`%${escapeLike(input.q)}%`); }
    const clause = where.join(' AND ');
    const count = await this.run(`SELECT COUNT(*) AS \`total\` FROM \`conversations\` c WHERE ${clause}`, params);
    const sortColumn = {
      lastMessageAt: 'c.`last_message_at`',
      createdAt: 'c.`created_at`',
      updatedAt: 'c.`updated_at`',
    }[input.sortBy];
    const rows = await this.run(
      `SELECT c.\`id\`,c.\`assistant_id\`,c.\`user_id\`,c.\`channel\`,c.\`language_code\`,c.\`status\`,c.\`title\`,
        c.\`metadata\`,c.\`message_count\`,c.\`last_message_at\`,c.\`created_at\`,c.\`updated_at\`
       FROM \`conversations\` c WHERE ${clause}
       ORDER BY ${sortColumn} ${input.sortOrder.toUpperCase()},c.\`id\` ${input.sortOrder.toUpperCase()} LIMIT ? OFFSET ?`,
      [...params, input.pageSize, (input.page - 1) * input.pageSize],
    );
    return { items: rows.map(mapConversation), page: input.page, pageSize: input.pageSize, total: Number(count[0]?.total ?? 0) };
  }

  async find(id: string, userId?: string, elevated = false, manager?: EntityManager, widget = false): Promise<Row> {
    if (!isUuidv7(id)) throw new NotFoundException('Conversation not found.');
    const params: unknown[] = [uuidToBinary(id), this.tenantBinary()];
    let owner = '';
    // Widget visitors own only user-less widget conversations of the verified tenant.
    if (widget) owner = " AND `user_id` IS NULL AND `channel`='widget'";
    else if (userId && !elevated) { owner = ' AND `user_id`=?'; params.push(uuidToBinary(userId)); }
    const rows = await this.run(
      `SELECT * FROM \`conversations\` WHERE \`id\`=? AND \`tenant_id\`=? AND \`deleted_at\` IS NULL${owner}`,
      params,
      manager,
    );
    if (!rows[0]) throw new NotFoundException('Conversation not found.');
    return rows[0];
  }

  async update(
    id: string,
    input: { title?: string | null; language?: string | null; metadata?: Record<string, string | number | boolean | string[]> | null },
    userId: string,
    elevated: boolean,
  ) {
    await this.find(id, userId, elevated);
    const fields: string[] = [];
    const params: unknown[] = [];
    if ('title' in input) { fields.push('`title`=?'); params.push(input.title); }
    if ('language' in input) { fields.push('`language_code`=?'); params.push(input.language); }
    if ('metadata' in input) { fields.push('`metadata`=?'); params.push(input.metadata === null ? null : JSON.stringify(input.metadata)); }
    if (!fields.length) throw new ConflictException('No conversation fields to update.');
    params.push(uuidToBinary(id), this.tenantBinary());
    await this.source.query(
      `UPDATE \`conversations\` SET ${fields.join(',')},\`updated_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`deleted_at\` IS NULL`,
      params,
    );
    return this.find(id, userId, elevated);
  }

  async archive(id: string, userId: string, elevated: boolean): Promise<void> {
    await this.find(id, userId, elevated);
    await this.source.query(
      `UPDATE \`conversations\` SET \`status\`='closed',\`closed_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`deleted_at\` IS NULL`,
      [uuidToBinary(id), this.tenantBinary()],
    );
  }

  async messages(id: string, limit: number, userId: string, elevated: boolean): Promise<Row[]> {
    const conversation = await this.find(id, userId, elevated);
    return this.run(
      `SELECT m.\`id\`,m.\`public_id\`,m.\`role\`,m.\`content\`,m.\`status\`,m.\`language_code\`,m.\`modality\`,
        m.\`model\`,m.\`knowledge_sources_used\`,m.\`tool_calls_count\`,m.\`error_code\`,m.\`created_at\`
       FROM \`conversation_messages\` m
       WHERE m.\`conversation_id\`=? AND m.\`tenant_id\`=?
       ORDER BY m.\`id\` DESC LIMIT ?`,
      [conversation.id, this.tenantBinary(), limit],
    );
  }

  async toolCalls(id: string, messageId: string, userId: string, elevated: boolean): Promise<Row[]> {
    await this.find(id, userId, elevated);
    if (!isUuidv7(messageId)) throw new NotFoundException('Message not found.');
    const message = await this.run(
      'SELECT `id` FROM `conversation_messages` WHERE `public_id`=? AND `conversation_id`=? AND `tenant_id`=?',
      [uuidToBinary(messageId), uuidToBinary(id), this.tenantBinary()],
    );
    if (!message[0]) throw new NotFoundException('Message not found.');
    return this.run(
      `SELECT \`tool_name\`,\`round\`,\`sequence_in_round\`,\`arguments\`,\`result_summary\`,
        \`outcome\`,\`error_code\`,\`duration_ms\`,\`created_at\`
       FROM \`message_tool_calls\` WHERE \`message_id\`=? AND \`tenant_id\`=? ORDER BY \`id\``,
      [message[0].id, this.tenantBinary()],
    );
  }

  async prepareAgentTurn(id: string, context: AgentExecutionContext): Promise<{
    assistantId: string; history: Array<{ role: 'user' | 'assistant'; content: string }>;
  }> {
    const widget = context.channel === 'widget';
    if (!context.userId && !widget) throw new NotFoundException('Conversation not found.');
    const row = await this.find(id, context.userId, context.permissions.includes('conversations:manage'), undefined, widget);
    if (row.status !== 'open') throw new NotFoundException('Conversation not found.');
    const activeAssistant = await this.run(
      `SELECT \`id\` FROM \`assistants\` WHERE \`id\`=? AND \`tenant_id\`=?
       AND \`status\`='active' AND \`deleted_at\` IS NULL`,
      [row.assistant_id, this.tenantBinary()],
    );
    if (!activeAssistant[0]) throw new NotFoundException('Conversation not found.');
    const rows = await this.run(
      `SELECT \`role\`,\`content\` FROM \`conversation_messages\`
       WHERE \`conversation_id\`=? AND \`tenant_id\`=? AND \`role\` IN ('user','assistant')
       ORDER BY \`id\` DESC LIMIT 20`,
      [row.id, this.tenantBinary()],
    );
    return {
      assistantId: binaryToUuid(row.assistant_id as Uint8Array),
      history: rows.reverse().map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: String(message.content).slice(0, 32000),
      })),
    };
  }

  async persistTurn(
    context: AgentExecutionContext,
    question: string,
    response: AgentResponse,
    traces: readonly ConversationToolTrace[],
  ): Promise<void> {
    const widget = context.channel === 'widget';
    if (!context.conversationId || (!context.userId && !widget)) return;
    const tenant = this.tenantBinary();
    const conversation = await this.find(
      context.conversationId,
      context.userId,
      context.permissions.includes('conversations:manage'),
      undefined,
      widget,
    );
    if (conversation.status !== 'open' || binaryToUuid(conversation.assistant_id as Uint8Array) !== context.assistantId) {
      throw new NotFoundException('Conversation not found.');
    }
    await this.source.transaction(async (manager) => {
      await this.insertMessage(manager, {
        conversationId: uuidToBinary(context.conversationId!),
        tenant,
        role: 'user',
        content: redactTranscript(question).slice(0, 32000),
        status: 'complete',
        language: context.language ?? conversation.language_code as string | null,
        modality: context.modality ?? 'text',
        model: null,
        sources: null,
        calls: 0,
        error: null,
      });
      const assistantMessageId = await this.insertMessage(manager, {
        conversationId: uuidToBinary(context.conversationId!),
        tenant,
        role: 'assistant',
        content: redactTranscript(response.answer).slice(0, 32000),
        status: response.success ? 'complete' : 'failed',
        language: context.language ?? conversation.language_code as string | null,
        modality: context.modality ?? 'text',
        model: response.model,
        sources: response.sources.slice(0, 10),
        calls: Math.min(traces.length, 255),
        error: response.success ? null : 'AGENT_REQUEST_FAILED',
      });
      for (const trace of traces.slice(0, 255)) {
        const safeArguments = { keys: Object.keys(trace.arguments).filter((key) => !isSensitiveKey(key)).slice(0, 30) };
        await manager.query(
          `INSERT INTO \`message_tool_calls\` (\`message_id\`,\`tenant_id\`,\`tool_name\`,\`round\`,
            \`sequence_in_round\`,\`arguments\`,\`result_summary\`,\`outcome\`,\`error_code\`,\`duration_ms\`)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            assistantMessageId,
            tenant,
            trace.name.slice(0, 64),
            trace.round,
            trace.sequence,
            JSON.stringify(safeArguments),
            trace.resultSummary ? JSON.stringify(trace.resultSummary) : null,
            trace.outcome,
            trace.errorCode,
            Math.min(trace.durationMs, 0xffffffff),
          ],
        );
      }
      await manager.query(
        `UPDATE \`conversations\` SET \`message_count\`=LEAST(\`message_count\`+2,65535),\`last_message_at\`=UTC_TIMESTAMP(3),
           \`updated_at\`=UTC_TIMESTAMP(3) WHERE \`id\`=? AND \`tenant_id\`=?`,
        [uuidToBinary(context.conversationId!), tenant],
      );
    });
  }

  async persistToolAudit(record: ToolAuditRecord): Promise<void> {
    const tenantId = this.currentTenantId();
    if (tenantId !== record.tenantId) throw new Error('Audit tenant context mismatch.');
    const tenant = uuidToBinary(tenantId);
    const conversation = record.conversationId && isUuidv7(record.conversationId) ? uuidToBinary(record.conversationId) : null;
    const assistant = record.assistantId && isUuidv7(record.assistantId) ? uuidToBinary(record.assistantId) : null;
    await this.source.query(
      `INSERT INTO \`tool_execution_logs\` (\`tenant_id\`,\`assistant_id\`,\`tool_name\`,\`conversation_id\`,
        \`user_id\`,\`request_id\`,\`arguments_digest\`,\`arguments_size\`,\`arguments_summary\`,\`result_summary\`,
        \`outcome\`,\`error_code\`,\`duration_ms\`,\`started_at\`,\`finished_at\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        tenant,
        assistant,
        record.toolName.slice(0, 64),
        conversation,
        record.userId && isUuidv7(record.userId) ? uuidToBinary(record.userId) : null,
        record.requestId.slice(0, 64),
        record.argumentsDigest ?? createHash('sha256').update('{}').digest('hex'),
        Math.min(record.argumentsSize ?? 0, 65535),
        JSON.stringify(record.argumentsSummary ?? { keys: [] }),
        record.resultSummary ? JSON.stringify(record.resultSummary) : null,
        record.outcome,
        record.errorCode,
        Math.min(record.durationMs, 0xffffffff),
        new Date(record.executedAt),
        new Date(),
      ],
    );
  }

  private async insertMessage(
    manager: EntityManager,
    input: {
      conversationId: Buffer; tenant: Buffer; role: string; content: string; status: string;
      language: string | null; model: string | null; sources: unknown; calls: number; error: string | null;
      modality: 'text' | 'voice';
    },
  ): Promise<number> {
    const result = await manager.query(
      `INSERT INTO \`conversation_messages\` (\`public_id\`,\`conversation_id\`,\`tenant_id\`,\`role\`,\`content\`,
        \`status\`,\`language_code\`,\`modality\`,\`model\`,\`knowledge_sources_used\`,\`tool_calls_count\`,\`error_code\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuidToBinary(newUuidv7()), input.conversationId, input.tenant, input.role, input.content,
        input.status, input.language, input.modality, input.model, input.sources ? JSON.stringify(input.sources) : null,
        input.calls, input.error,
      ],
    );
    return Number((result as { insertId?: number }).insertId);
  }
}

export const TOOL_AUDIT_SINK = Symbol('TOOL_AUDIT_SINK');

export interface ToolAuditSink {
  persistToolAudit(record: ToolAuditRecord): Promise<void>;
}

function mapConversation(row: Row) {
  return {
    id: binaryToUuid(row.id as Uint8Array),
    assistantId: binaryToUuid(row.assistant_id as Uint8Array),
    userId: row.user_id ? binaryToUuid(row.user_id as Uint8Array) : null,
    channel: row.channel,
    language: row.language_code,
    status: row.status,
    title: row.title,
    metadata: parseStoredJson(row.metadata),
    messageCount: Number(row.message_count),
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isSensitiveKey(key: string): boolean {
  return /(secret|password|token|credential|api.?key|authorization|private.?key)/i.test(key);
}

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function redactTranscript(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?)[^"'\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/g, '[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]');
}
