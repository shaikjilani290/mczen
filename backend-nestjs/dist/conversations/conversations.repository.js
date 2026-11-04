"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_AUDIT_SINK = exports.ConversationsRepository = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const node_crypto_1 = require("node:crypto");
const typeorm_2 = require("typeorm");
const uuid_1 = require("../common/ids/uuid");
const tenant_scoped_repository_1 = require("../common/tenant/tenant-scoped.repository");
let ConversationsRepository = class ConversationsRepository extends tenant_scoped_repository_1.TenantScopedRepository {
    source;
    constructor(source) {
        super(source.getRepository('conversations'));
        this.source = source;
    }
    tenantBinary() { return (0, uuid_1.uuidToBinary)(this.currentTenantId()); }
    async run(sql, params = [], manager) {
        return (manager ?? this.source).query(sql, params);
    }
    async create(input) {
        const tenant = this.tenantBinary();
        const assistant = (0, uuid_1.uuidToBinary)(input.assistantId);
        const owner = (0, uuid_1.uuidToBinary)(input.userId);
        const check = await this.run(`SELECT \`id\` FROM \`assistants\` WHERE \`id\`=? AND \`tenant_id\`=?
       AND \`status\`='active' AND \`deleted_at\` IS NULL`, [assistant, tenant]);
        if (!check[0])
            throw new common_1.NotFoundException('Assistant not found.');
        const id = (0, uuid_1.newUuidv7)();
        await this.source.query(`INSERT INTO \`conversations\` (\`id\`,\`tenant_id\`,\`assistant_id\`,\`user_id\`,\`title\`,\`metadata\`,\`channel\`,\`language_code\`)
       VALUES (?,?,?,?,?,?,?,?)`, [(0, uuid_1.uuidToBinary)(id), tenant, assistant, owner, input.title, input.metadata ? JSON.stringify(input.metadata) : null, input.channel, input.language]);
        return id;
    }
    async list(input) {
        const tenant = this.tenantBinary();
        const where = ['c.`tenant_id`=?', 'c.`deleted_at` IS NULL'];
        const params = [tenant];
        if (!input.elevated) {
            where.push('c.`user_id`=?');
            params.push((0, uuid_1.uuidToBinary)(input.userId));
        }
        if (input.status) {
            where.push('c.`status`=?');
            params.push(input.status);
        }
        if (input.assistantId) {
            where.push('c.`assistant_id`=?');
            params.push((0, uuid_1.uuidToBinary)(input.assistantId));
        }
        if (input.q) {
            where.push('c.`title` LIKE ?');
            params.push(`%${escapeLike(input.q)}%`);
        }
        const clause = where.join(' AND ');
        const count = await this.run(`SELECT COUNT(*) AS \`total\` FROM \`conversations\` c WHERE ${clause}`, params);
        const sortColumn = {
            lastMessageAt: 'c.`last_message_at`',
            createdAt: 'c.`created_at`',
            updatedAt: 'c.`updated_at`',
        }[input.sortBy];
        const rows = await this.run(`SELECT c.\`id\`,c.\`assistant_id\`,c.\`user_id\`,c.\`channel\`,c.\`language_code\`,c.\`status\`,c.\`title\`,
        c.\`metadata\`,c.\`message_count\`,c.\`last_message_at\`,c.\`created_at\`,c.\`updated_at\`
       FROM \`conversations\` c WHERE ${clause}
       ORDER BY ${sortColumn} ${input.sortOrder.toUpperCase()},c.\`id\` ${input.sortOrder.toUpperCase()} LIMIT ? OFFSET ?`, [...params, input.pageSize, (input.page - 1) * input.pageSize]);
        return { items: rows.map(mapConversation), page: input.page, pageSize: input.pageSize, total: Number(count[0]?.total ?? 0) };
    }
    async find(id, userId, elevated = false, manager, widget = false) {
        if (!(0, uuid_1.isUuidv7)(id))
            throw new common_1.NotFoundException('Conversation not found.');
        const params = [(0, uuid_1.uuidToBinary)(id), this.tenantBinary()];
        let owner = '';
        if (widget)
            owner = " AND `user_id` IS NULL AND `channel`='widget'";
        else if (userId && !elevated) {
            owner = ' AND `user_id`=?';
            params.push((0, uuid_1.uuidToBinary)(userId));
        }
        const rows = await this.run(`SELECT * FROM \`conversations\` WHERE \`id\`=? AND \`tenant_id\`=? AND \`deleted_at\` IS NULL${owner}`, params, manager);
        if (!rows[0])
            throw new common_1.NotFoundException('Conversation not found.');
        return rows[0];
    }
    async update(id, input, userId, elevated) {
        await this.find(id, userId, elevated);
        const fields = [];
        const params = [];
        if ('title' in input) {
            fields.push('`title`=?');
            params.push(input.title);
        }
        if ('language' in input) {
            fields.push('`language_code`=?');
            params.push(input.language);
        }
        if ('metadata' in input) {
            fields.push('`metadata`=?');
            params.push(input.metadata === null ? null : JSON.stringify(input.metadata));
        }
        if (!fields.length)
            throw new common_1.ConflictException('No conversation fields to update.');
        params.push((0, uuid_1.uuidToBinary)(id), this.tenantBinary());
        await this.source.query(`UPDATE \`conversations\` SET ${fields.join(',')},\`updated_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`deleted_at\` IS NULL`, params);
        return this.find(id, userId, elevated);
    }
    async archive(id, userId, elevated) {
        await this.find(id, userId, elevated);
        await this.source.query(`UPDATE \`conversations\` SET \`status\`='closed',\`closed_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`deleted_at\` IS NULL`, [(0, uuid_1.uuidToBinary)(id), this.tenantBinary()]);
    }
    async messages(id, limit, userId, elevated) {
        const conversation = await this.find(id, userId, elevated);
        return this.run(`SELECT m.\`id\`,m.\`public_id\`,m.\`role\`,m.\`content\`,m.\`status\`,m.\`language_code\`,m.\`modality\`,
        m.\`model\`,m.\`knowledge_sources_used\`,m.\`tool_calls_count\`,m.\`error_code\`,m.\`created_at\`
       FROM \`conversation_messages\` m
       WHERE m.\`conversation_id\`=? AND m.\`tenant_id\`=?
       ORDER BY m.\`id\` DESC LIMIT ?`, [conversation.id, this.tenantBinary(), limit]);
    }
    async toolCalls(id, messageId, userId, elevated) {
        await this.find(id, userId, elevated);
        if (!(0, uuid_1.isUuidv7)(messageId))
            throw new common_1.NotFoundException('Message not found.');
        const message = await this.run('SELECT `id` FROM `conversation_messages` WHERE `public_id`=? AND `conversation_id`=? AND `tenant_id`=?', [(0, uuid_1.uuidToBinary)(messageId), (0, uuid_1.uuidToBinary)(id), this.tenantBinary()]);
        if (!message[0])
            throw new common_1.NotFoundException('Message not found.');
        return this.run(`SELECT \`tool_name\`,\`round\`,\`sequence_in_round\`,\`arguments\`,\`result_summary\`,
        \`outcome\`,\`error_code\`,\`duration_ms\`,\`created_at\`
       FROM \`message_tool_calls\` WHERE \`message_id\`=? AND \`tenant_id\`=? ORDER BY \`id\``, [message[0].id, this.tenantBinary()]);
    }
    async prepareAgentTurn(id, context) {
        const widget = context.channel === 'widget';
        if (!context.userId && !widget)
            throw new common_1.NotFoundException('Conversation not found.');
        const row = await this.find(id, context.userId, context.permissions.includes('conversations:manage'), undefined, widget);
        if (row.status !== 'open')
            throw new common_1.NotFoundException('Conversation not found.');
        const activeAssistant = await this.run(`SELECT \`id\` FROM \`assistants\` WHERE \`id\`=? AND \`tenant_id\`=?
       AND \`status\`='active' AND \`deleted_at\` IS NULL`, [row.assistant_id, this.tenantBinary()]);
        if (!activeAssistant[0])
            throw new common_1.NotFoundException('Conversation not found.');
        const rows = await this.run(`SELECT \`role\`,\`content\` FROM \`conversation_messages\`
       WHERE \`conversation_id\`=? AND \`tenant_id\`=? AND \`role\` IN ('user','assistant')
       ORDER BY \`id\` DESC LIMIT 20`, [row.id, this.tenantBinary()]);
        return {
            assistantId: (0, uuid_1.binaryToUuid)(row.assistant_id),
            history: rows.reverse().map((message) => ({
                role: message.role,
                content: String(message.content).slice(0, 32000),
            })),
        };
    }
    async persistTurn(context, question, response, traces) {
        const widget = context.channel === 'widget';
        if (!context.conversationId || (!context.userId && !widget))
            return;
        const tenant = this.tenantBinary();
        const conversation = await this.find(context.conversationId, context.userId, context.permissions.includes('conversations:manage'), undefined, widget);
        if (conversation.status !== 'open' || (0, uuid_1.binaryToUuid)(conversation.assistant_id) !== context.assistantId) {
            throw new common_1.NotFoundException('Conversation not found.');
        }
        await this.source.transaction(async (manager) => {
            await this.insertMessage(manager, {
                conversationId: (0, uuid_1.uuidToBinary)(context.conversationId),
                tenant,
                role: 'user',
                content: redactTranscript(question).slice(0, 32000),
                status: 'complete',
                language: context.language ?? conversation.language_code,
                modality: context.modality ?? 'text',
                model: null,
                sources: null,
                calls: 0,
                error: null,
            });
            const assistantMessageId = await this.insertMessage(manager, {
                conversationId: (0, uuid_1.uuidToBinary)(context.conversationId),
                tenant,
                role: 'assistant',
                content: redactTranscript(response.answer).slice(0, 32000),
                status: response.success ? 'complete' : 'failed',
                language: context.language ?? conversation.language_code,
                modality: context.modality ?? 'text',
                model: response.model,
                sources: response.sources.slice(0, 10),
                calls: Math.min(traces.length, 255),
                error: response.success ? null : 'AGENT_REQUEST_FAILED',
            });
            for (const trace of traces.slice(0, 255)) {
                const safeArguments = { keys: Object.keys(trace.arguments).filter((key) => !isSensitiveKey(key)).slice(0, 30) };
                await manager.query(`INSERT INTO \`message_tool_calls\` (\`message_id\`,\`tenant_id\`,\`tool_name\`,\`round\`,
            \`sequence_in_round\`,\`arguments\`,\`result_summary\`,\`outcome\`,\`error_code\`,\`duration_ms\`)
           VALUES (?,?,?,?,?,?,?,?,?,?)`, [
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
                ]);
            }
            await manager.query(`UPDATE \`conversations\` SET \`message_count\`=LEAST(\`message_count\`+2,65535),\`last_message_at\`=UTC_TIMESTAMP(3),
           \`updated_at\`=UTC_TIMESTAMP(3) WHERE \`id\`=? AND \`tenant_id\`=?`, [(0, uuid_1.uuidToBinary)(context.conversationId), tenant]);
        });
    }
    async persistToolAudit(record) {
        const tenantId = this.currentTenantId();
        if (tenantId !== record.tenantId)
            throw new Error('Audit tenant context mismatch.');
        const tenant = (0, uuid_1.uuidToBinary)(tenantId);
        const conversation = record.conversationId && (0, uuid_1.isUuidv7)(record.conversationId) ? (0, uuid_1.uuidToBinary)(record.conversationId) : null;
        const assistant = record.assistantId && (0, uuid_1.isUuidv7)(record.assistantId) ? (0, uuid_1.uuidToBinary)(record.assistantId) : null;
        await this.source.query(`INSERT INTO \`tool_execution_logs\` (\`tenant_id\`,\`assistant_id\`,\`tool_name\`,\`conversation_id\`,
        \`user_id\`,\`request_id\`,\`arguments_digest\`,\`arguments_size\`,\`arguments_summary\`,\`result_summary\`,
        \`outcome\`,\`error_code\`,\`duration_ms\`,\`started_at\`,\`finished_at\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
            tenant,
            assistant,
            record.toolName.slice(0, 64),
            conversation,
            record.userId && (0, uuid_1.isUuidv7)(record.userId) ? (0, uuid_1.uuidToBinary)(record.userId) : null,
            record.requestId.slice(0, 64),
            record.argumentsDigest ?? (0, node_crypto_1.createHash)('sha256').update('{}').digest('hex'),
            Math.min(record.argumentsSize ?? 0, 65535),
            JSON.stringify(record.argumentsSummary ?? { keys: [] }),
            record.resultSummary ? JSON.stringify(record.resultSummary) : null,
            record.outcome,
            record.errorCode,
            Math.min(record.durationMs, 0xffffffff),
            new Date(record.executedAt),
            new Date(),
        ]);
    }
    async insertMessage(manager, input) {
        const result = await manager.query(`INSERT INTO \`conversation_messages\` (\`public_id\`,\`conversation_id\`,\`tenant_id\`,\`role\`,\`content\`,
        \`status\`,\`language_code\`,\`modality\`,\`model\`,\`knowledge_sources_used\`,\`tool_calls_count\`,\`error_code\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
            (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()), input.conversationId, input.tenant, input.role, input.content,
            input.status, input.language, input.modality, input.model, input.sources ? JSON.stringify(input.sources) : null,
            input.calls, input.error,
        ]);
        return Number(result.insertId);
    }
};
exports.ConversationsRepository = ConversationsRepository;
exports.ConversationsRepository = ConversationsRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], ConversationsRepository);
exports.TOOL_AUDIT_SINK = Symbol('TOOL_AUDIT_SINK');
function mapConversation(row) {
    return {
        id: (0, uuid_1.binaryToUuid)(row.id),
        assistantId: (0, uuid_1.binaryToUuid)(row.assistant_id),
        userId: row.user_id ? (0, uuid_1.binaryToUuid)(row.user_id) : null,
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
function escapeLike(value) {
    return value.replace(/[\\%_]/g, '\\$&');
}
function isSensitiveKey(key) {
    return /(secret|password|token|credential|api.?key|authorization|private.?key)/i.test(key);
}
function parseStoredJson(value) {
    if (typeof value !== 'string')
        return value ?? null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function redactTranscript(value) {
    return value
        .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
        .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?)[^"'\s,;]+/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/g, '[REDACTED]')
        .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]');
}
//# sourceMappingURL=conversations.repository.js.map