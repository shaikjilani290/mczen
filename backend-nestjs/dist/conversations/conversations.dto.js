"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCreateConversation = parseCreateConversation;
exports.parseUpdateConversation = parseUpdateConversation;
exports.parseConversationQuery = parseConversationQuery;
exports.parseTranscriptQuery = parseTranscriptQuery;
exports.parseAgentConversationId = parseAgentConversationId;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
const LANGUAGES = ['en', 'hi', 'te'];
const CHANNELS = ['chat', 'voice', 'widget'];
function parseMetadata(value) {
    if (value === undefined || value === null)
        return null;
    const record = object(value, Object.keys(value));
    const entries = Object.entries(record);
    if (entries.length > 20)
        throw new common_1.BadRequestException('metadata has too many fields.');
    const result = {};
    for (const [key, item] of entries) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/.test(key) ||
            /(secret|password|token|credential|api.?key|authorization|private.?key)/i.test(key)) {
            throw new common_1.BadRequestException('metadata contains an unsupported field.');
        }
        if (typeof item === 'string' && item.length <= 256)
            result[key] = redactMetadata(item);
        else if (typeof item === 'number' && Number.isFinite(item))
            result[key] = item;
        else if (typeof item === 'boolean')
            result[key] = item;
        else if (Array.isArray(item) && item.length <= 20 &&
            item.every((entry) => typeof entry === 'string' && entry.length <= 100)) {
            result[key] = item.map(redactMetadata);
        }
        else
            throw new common_1.BadRequestException('metadata values must be short primitive values.');
    }
    if (JSON.stringify(result).length > 4096)
        throw new common_1.BadRequestException('metadata is too large.');
    return result;
}
function object(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new common_1.BadRequestException('A JSON object is required.');
    }
    const record = value;
    if (Object.keys(record).some((key) => !allowed.includes(key))) {
        throw new common_1.BadRequestException('The request contains an unsupported field.');
    }
    return record;
}
function boundedString(value, key, max, optional = false) {
    if (optional && value === undefined)
        return undefined;
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
        throw new common_1.BadRequestException(`${key} must contain between 1 and ${max} characters.`);
    }
    return value.trim();
}
function parseCreateConversation(value) {
    const input = object(value, ['assistantId', 'title', 'channel', 'language', 'metadata']);
    if (!(0, uuid_1.isUuidv7)(input.assistantId))
        throw new common_1.BadRequestException('assistantId must be a valid assistant id.');
    if (input.channel !== undefined && !CHANNELS.includes(input.channel)) {
        throw new common_1.BadRequestException('channel is invalid.');
    }
    if (input.language !== undefined && !LANGUAGES.includes(input.language)) {
        throw new common_1.BadRequestException('language is invalid.');
    }
    return {
        assistantId: input.assistantId,
        title: redactMetadata(boundedString(input.title, 'title', 150, true) ?? '') || null,
        channel: input.channel ?? 'chat',
        language: input.language ?? null,
        metadata: parseMetadata(input.metadata),
    };
}
function parseUpdateConversation(value) {
    const input = object(value, ['title', 'language', 'metadata']);
    const result = {};
    if ('title' in input) {
        result.title = input.title === null ? null : redactMetadata(boundedString(input.title, 'title', 150));
    }
    if ('language' in input) {
        if (input.language !== null && !LANGUAGES.includes(input.language)) {
            throw new common_1.BadRequestException('language is invalid.');
        }
        result.language = input.language;
    }
    if ('metadata' in input)
        result.metadata = parseMetadata(input.metadata);
    if (!Object.keys(result).length)
        throw new common_1.BadRequestException('At least one field is required.');
    return result;
}
function parseConversationQuery(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new common_1.BadRequestException('Invalid query.');
    }
    const input = value;
    if (Object.keys(input).some((key) => !['page', 'pageSize', 'status', 'assistantId', 'q', 'sortBy', 'sortOrder'].includes(key))) {
        throw new common_1.BadRequestException('The query contains an unsupported field.');
    }
    const int = (v, fallback, max) => {
        if (v === undefined)
            return fallback;
        if (typeof v !== 'string' || !/^\d{1,5}$/.test(v) || Number(v) < 1 || Number(v) > max) {
            throw new common_1.BadRequestException('Pagination parameters are invalid.');
        }
        return Number(v);
    };
    if (input.status !== undefined && input.status !== 'open' && input.status !== 'closed') {
        throw new common_1.BadRequestException('status is invalid.');
    }
    if (input.assistantId !== undefined && !(0, uuid_1.isUuidv7)(input.assistantId)) {
        throw new common_1.BadRequestException('assistantId is invalid.');
    }
    const q = input.q === undefined ? undefined : boundedString(input.q, 'q', 150);
    const sortBy = input.sortBy === undefined ? 'lastMessageAt' : input.sortBy;
    const sortOrder = input.sortOrder === undefined ? 'desc' : input.sortOrder;
    if (typeof sortBy !== 'string' || typeof sortOrder !== 'string' ||
        !['lastMessageAt', 'createdAt', 'updatedAt'].includes(sortBy) ||
        !['asc', 'desc'].includes(sortOrder))
        throw new common_1.BadRequestException('Sorting parameters are invalid.');
    return {
        page: int(input.page, 1, 100000),
        pageSize: int(input.pageSize, 20, 100),
        status: input.status,
        assistantId: input.assistantId,
        q,
        sortBy: sortBy,
        sortOrder: sortOrder,
    };
}
function parseTranscriptQuery(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new common_1.BadRequestException('Invalid query.');
    const input = value;
    if (Object.keys(input).some((key) => key !== 'limit'))
        throw new common_1.BadRequestException('The query contains an unsupported field.');
    if (input.limit === undefined)
        return 100;
    if (typeof input.limit !== 'string' || !/^\d{1,3}$/.test(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 200) {
        throw new common_1.BadRequestException('limit must be an integer from 1 to 200.');
    }
    return Number(input.limit);
}
function parseAgentConversationId(value) {
    if (value === undefined)
        return undefined;
    if (!(0, uuid_1.isUuidv7)(value))
        throw new common_1.BadRequestException('conversationId is invalid.');
    return value;
}
function redactMetadata(value) {
    return value
        .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
        .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?)[^"'\s,;]+/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/g, '[REDACTED]')
        .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
}
//# sourceMappingURL=conversations.dto.js.map