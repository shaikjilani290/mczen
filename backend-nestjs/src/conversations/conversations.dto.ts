import { BadRequestException } from '@nestjs/common';
import { isUuidv7 } from '../common/ids/uuid';

const LANGUAGES = ['en', 'hi', 'te'] as const;
const CHANNELS = ['chat', 'voice', 'widget'] as const;

function parseMetadata(value: unknown): Record<string, string | number | boolean | string[]> | null {
  if (value === undefined || value === null) return null;
  const record = object(value, Object.keys(value as object));
  const entries = Object.entries(record);
  if (entries.length > 20) throw new BadRequestException('metadata has too many fields.');
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [key, item] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/.test(key) ||
        /(secret|password|token|credential|api.?key|authorization|private.?key)/i.test(key)) {
      throw new BadRequestException('metadata contains an unsupported field.');
    }
    if (typeof item === 'string' && item.length <= 256) result[key] = redactMetadata(item);
    else if (typeof item === 'number' && Number.isFinite(item)) result[key] = item;
    else if (typeof item === 'boolean') result[key] = item;
    else if (Array.isArray(item) && item.length <= 20 &&
      item.every((entry) => typeof entry === 'string' && entry.length <= 100)) {
      result[key] = (item as string[]).map(redactMetadata);
    } else throw new BadRequestException('metadata values must be short primitive values.');
  }
  if (JSON.stringify(result).length > 4096) throw new BadRequestException('metadata is too large.');
  return result;
}

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new BadRequestException('A JSON object is required.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new BadRequestException('The request contains an unsupported field.');
  }
  return record;
}

function boundedString(value: unknown, key: string, max: number, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new BadRequestException(`${key} must contain between 1 and ${max} characters.`);
  }
  return value.trim();
}

export function parseCreateConversation(value: unknown) {
  const input = object(value, ['assistantId', 'title', 'channel', 'language', 'metadata']);
  if (!isUuidv7(input.assistantId)) throw new BadRequestException('assistantId must be a valid assistant id.');
  if (input.channel !== undefined && !(CHANNELS as readonly unknown[]).includes(input.channel)) {
    throw new BadRequestException('channel is invalid.');
  }
  if (input.language !== undefined && !(LANGUAGES as readonly unknown[]).includes(input.language)) {
    throw new BadRequestException('language is invalid.');
  }
  return {
    assistantId: input.assistantId,
    title: redactMetadata(boundedString(input.title, 'title', 150, true) ?? '') || null,
    channel: (input.channel as (typeof CHANNELS)[number] | undefined) ?? 'chat',
    language: (input.language as (typeof LANGUAGES)[number] | undefined) ?? null,
    metadata: parseMetadata(input.metadata),
  };
}

export function parseUpdateConversation(value: unknown) {
  const input = object(value, ['title', 'language', 'metadata']);
  const result: { title?: string | null; language?: string | null; metadata?: Record<string, string | number | boolean | string[]> | null } = {};
  if ('title' in input) {
    result.title = input.title === null ? null : redactMetadata(boundedString(input.title, 'title', 150)!);
  }
  if ('language' in input) {
    if (input.language !== null && !(LANGUAGES as readonly unknown[]).includes(input.language)) {
      throw new BadRequestException('language is invalid.');
    }
    result.language = input.language as string | null;
  }
  if ('metadata' in input) result.metadata = parseMetadata(input.metadata);
  if (!Object.keys(result).length) throw new BadRequestException('At least one field is required.');
  return result;
}

export function parseConversationQuery(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Invalid query.');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['page', 'pageSize', 'status', 'assistantId', 'q', 'sortBy', 'sortOrder'].includes(key))) {
    throw new BadRequestException('The query contains an unsupported field.');
  }
  const int = (v: unknown, fallback: number, max: number) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^\d{1,5}$/.test(v) || Number(v) < 1 || Number(v) > max) {
      throw new BadRequestException('Pagination parameters are invalid.');
    }
    return Number(v);
  };
  if (input.status !== undefined && input.status !== 'open' && input.status !== 'closed') {
    throw new BadRequestException('status is invalid.');
  }
  if (input.assistantId !== undefined && !isUuidv7(input.assistantId)) {
    throw new BadRequestException('assistantId is invalid.');
  }
  const q = input.q === undefined ? undefined : boundedString(input.q, 'q', 150);
  const sortBy = input.sortBy === undefined ? 'lastMessageAt' : input.sortBy;
  const sortOrder = input.sortOrder === undefined ? 'desc' : input.sortOrder;
  if (typeof sortBy !== 'string' || typeof sortOrder !== 'string' ||
      !['lastMessageAt', 'createdAt', 'updatedAt'].includes(sortBy) ||
      !['asc', 'desc'].includes(sortOrder)) throw new BadRequestException('Sorting parameters are invalid.');
  return {
    page: int(input.page, 1, 100000),
    pageSize: int(input.pageSize, 20, 100),
    status: input.status as 'open' | 'closed' | undefined,
    assistantId: input.assistantId as string | undefined,
    q,
    sortBy: sortBy as 'lastMessageAt' | 'createdAt' | 'updatedAt',
    sortOrder: sortOrder as 'asc' | 'desc',
  };
}

export function parseTranscriptQuery(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid query.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'limit')) throw new BadRequestException('The query contains an unsupported field.');
  if (input.limit === undefined) return 100;
  if (typeof input.limit !== 'string' || !/^\d{1,3}$/.test(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 200) {
    throw new BadRequestException('limit must be an integer from 1 to 200.');
  }
  return Number(input.limit);
}

export function parseAgentConversationId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isUuidv7(value)) throw new BadRequestException('conversationId is invalid.');
  return value;
}

function redactMetadata(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["']?)[^"'\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{15,})\b/g, '[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
}
