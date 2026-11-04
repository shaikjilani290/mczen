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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationsService = void 0;
const common_1 = require("@nestjs/common");
const tenant_context_store_1 = require("../common/tenant/tenant-context.store");
const conversations_repository_1 = require("./conversations.repository");
let ConversationsService = class ConversationsService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    create(input) {
        return this.repository.create(input);
    }
    list(input) {
        return this.repository.list(input);
    }
    async get(id, user) {
        const row = await this.repository.find(id, user.userId, this.canManage());
        const messages = await this.repository.messages(id, 20, user.userId, this.canManage());
        return { ...this.mapRow(row), messages: messages.reverse().map(mapMessage) };
    }
    async update(id, input, user) {
        return this.mapRow(await this.repository.update(id, input, user.userId, this.canManage()));
    }
    async archive(id, user) {
        return this.repository.archive(id, user.userId, this.canManage());
    }
    async transcript(id, limit, user) {
        const rows = await this.repository.messages(id, limit, user.userId, this.canManage());
        return rows.reverse().map(mapMessage);
    }
    toolCalls(id, messageId, user) {
        return this.repository.toolCalls(id, messageId, user.userId, this.canManage());
    }
    prepareAgentTurn(id, context) {
        return this.repository.prepareAgentTurn(id, context);
    }
    persistTurn(context, question, response, traces) {
        return this.repository.persistTurn(context, question, response, traces);
    }
    persistToolAudit(record) {
        return this.repository.persistToolAudit(record);
    }
    canManage() {
        return tenant_context_store_1.tenantContextStore.get()?.permissions.includes('conversations:manage') ?? false;
    }
    mapRow(row) {
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
};
exports.ConversationsService = ConversationsService;
exports.ConversationsService = ConversationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [conversations_repository_1.ConversationsRepository])
], ConversationsService);
function binary(value) {
    if (!(value instanceof Uint8Array))
        throw new TypeError('Expected a database UUID.');
    const hex = Buffer.from(value).toString('hex');
    if (hex.length !== 32)
        throw new TypeError('Expected a BINARY(16) UUID.');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function mapMessage(row) {
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
//# sourceMappingURL=conversations.service.js.map