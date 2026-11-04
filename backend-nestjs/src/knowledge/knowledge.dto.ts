import { BadRequestException } from '@nestjs/common';
import { bodyObject } from '../auth/auth.dto';
import { isUuidv7 } from '../common/ids/uuid';
import { sanitizeText } from './text-utils';

export const KNOWLEDGE_LANGUAGES = ['en', 'hi', 'te'] as const;
export type KnowledgeLanguage = (typeof KNOWLEDGE_LANGUAGES)[number];
export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export const PUBLICATIONS = ['draft', 'published'] as const;
export type Publication = (typeof PUBLICATIONS)[number];
export const DOCUMENT_STATUSES = ['pending', 'processing', 'processed', 'failed', 'archived'] as const;

export const DEFAULT_CATEGORIES = [
  { slug: 'symptoms', name: 'Symptoms' },
  { slug: 'nutrition', name: 'Nutrition' },
  { slug: 'fitness', name: 'Fitness' },
  { slug: 'sleep-wellness', name: 'Sleep & Wellness' },
  { slug: 'mczen-products', name: 'McZEN Products' },
  { slug: 'health-education', name: 'Health Education' },
] as const;

export const MAX_ARTICLE_CONTENT = 200_000;
export const MAX_TAGS = 10;
export const MAX_PAGE_SIZE = 50;
export const MAX_SEARCH_LIMIT = 20;

const invalid = (): never => {
  throw new BadRequestException('Invalid request.');
};

function text(v: unknown, max: number, opts: { min?: number; nullable?: boolean } = {}): string | null {
  if (v === null && opts.nullable) return null;
  if (typeof v !== 'string') return invalid();
  const s = sanitizeText(v);
  if (s.length < (opts.min ?? 0) || s.length > max) return invalid();
  if (s === '' && opts.nullable) return null;
  return s;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : invalid();
}

/** http(s) only, no embedded credentials; stored as plain text and only rendered as a link by the UI after this check. */
function webUrl(v: unknown): string | null {
  const s = text(v, 500, { nullable: true });
  if (s === null) return null;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return invalid();
  } catch {
    return invalid();
  }
  return s;
}

export function parseTags(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_TAGS) return invalid();
  const tags = v.map((tag) => (text(tag, 50, { min: 1 }) as string).toLowerCase());
  return [...new Set(tags)];
}

function uuid(v: unknown): string {
  return isUuidv7(v) ? (v as string) : invalid();
}

export interface CategoryInput { name: string; description?: string | null }

export function parseCategory(body: unknown, partial = false): Partial<CategoryInput> {
  const b = bodyObject(body, ['name', 'description']);
  const out: Partial<CategoryInput> = {};
  if (!partial || 'name' in b) out.name = text(b.name, 100, { min: 1 }) as string;
  if ('description' in b) out.description = text(b.description, 500, { nullable: true });
  if (partial && Object.keys(out).length === 0) invalid();
  return out;
}

export interface ArticleInput {
  title: string;
  summary?: string | null;
  content: string;
  categoryId: string;
  language: KnowledgeLanguage;
  status: 'draft' | 'published';
  tags: string[];
  sourceName?: string | null;
  sourceUrl?: string | null;
  referenceNote?: string | null;
}

const ARTICLE_KEYS = ['title', 'summary', 'content', 'categoryId', 'language', 'status', 'tags', 'sourceName', 'sourceUrl', 'referenceNote'];

export function parseArticle(body: unknown, partial = false): Partial<ArticleInput> {
  const b = bodyObject(body, ARTICLE_KEYS);
  const out: Partial<ArticleInput> = {};
  const need = (key: string) => !partial || key in b;
  if (need('title')) out.title = text(b.title, 200, { min: 1 }) as string;
  if (need('content')) out.content = text(b.content, MAX_ARTICLE_CONTENT, { min: 1 }) as string;
  if (need('categoryId')) out.categoryId = uuid(b.categoryId);
  if ('language' in b || !partial) out.language = 'language' in b ? oneOf(b.language, KNOWLEDGE_LANGUAGES) : 'en';
  if ('status' in b) out.status = oneOf(b.status, PUBLICATIONS);
  else if (!partial) out.status = 'draft';
  if ('tags' in b) out.tags = parseTags(b.tags);
  else if (!partial) out.tags = [];
  if ('summary' in b) out.summary = text(b.summary, 1000, { nullable: true });
  if ('sourceName' in b) out.sourceName = text(b.sourceName, 200, { nullable: true });
  if ('sourceUrl' in b) out.sourceUrl = webUrl(b.sourceUrl);
  if ('referenceNote' in b) out.referenceNote = text(b.referenceNote, 500, { nullable: true });
  if (partial && Object.keys(out).length === 0) invalid();
  return out;
}

export interface Page { page: number; pageSize: number }

function intParam(v: unknown, def: number, min: number, max: number): number {
  if (v === undefined || v === '') return def;
  if (typeof v !== 'string' || !/^\d{1,6}$/.test(v)) return invalid();
  const n = Number(v);
  return n < min || n > max ? invalid() : n;
}

function queryObject(q: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!q || typeof q !== 'object') return {};
  const obj = q as Record<string, unknown>;
  if (Object.keys(obj).some((key) => !allowed.includes(key))) return invalid();
  return obj;
}

function optionalString(v: unknown, max: number): string | undefined {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max) return invalid();
  return sanitizeText(v);
}

export interface ArticleQuery extends Page {
  status?: ArticleStatus;
  categoryId?: string;
  language?: KnowledgeLanguage;
  tag?: string;
  q?: string;
}

export function parseArticleQuery(raw: unknown): ArticleQuery {
  const q = queryObject(raw, ['status', 'categoryId', 'language', 'tag', 'q', 'page', 'pageSize']);
  const out: ArticleQuery = { page: intParam(q.page, 1, 1, 10000), pageSize: intParam(q.pageSize, 20, 1, MAX_PAGE_SIZE) };
  if (q.status) out.status = oneOf(q.status, ARTICLE_STATUSES);
  if (q.categoryId) out.categoryId = uuid(q.categoryId);
  if (q.language) out.language = oneOf(q.language, KNOWLEDGE_LANGUAGES);
  out.tag = optionalString(q.tag, 50)?.toLowerCase();
  out.q = optionalString(q.q, 200);
  return out;
}

export interface DocumentQuery extends Page {
  status?: (typeof DOCUMENT_STATUSES)[number];
  categoryId?: string;
  language?: KnowledgeLanguage;
  q?: string;
}

export function parseDocumentQuery(raw: unknown): DocumentQuery {
  const q = queryObject(raw, ['status', 'categoryId', 'language', 'q', 'page', 'pageSize']);
  const out: DocumentQuery = { page: intParam(q.page, 1, 1, 10000), pageSize: intParam(q.pageSize, 20, 1, MAX_PAGE_SIZE) };
  if (q.status) out.status = oneOf(q.status, DOCUMENT_STATUSES);
  if (q.categoryId) out.categoryId = uuid(q.categoryId);
  if (q.language) out.language = oneOf(q.language, KNOWLEDGE_LANGUAGES);
  out.q = optionalString(q.q, 200);
  return out;
}

export interface SearchQuery {
  q: string;
  categoryId?: string;
  language?: KnowledgeLanguage;
  limit: number;
}

export function parseSearchQuery(raw: unknown): SearchQuery {
  const q = queryObject(raw, ['q', 'categoryId', 'language', 'limit']);
  const term = optionalString(q.q, 500);
  if (!term) return invalid();
  const out: SearchQuery = { q: term as string, limit: intParam(q.limit, 8, 1, MAX_SEARCH_LIMIT) };
  if (q.categoryId) out.categoryId = uuid(q.categoryId);
  if (q.language) out.language = oneOf(q.language, KNOWLEDGE_LANGUAGES);
  return out;
}

/** Multipart text fields that accompany an uploaded document. */
export interface DocumentMetaInput {
  title?: string;
  categoryId?: string;
  language?: KnowledgeLanguage;
  publication?: Publication;
  sourceName?: string | null;
}

export function parseDocumentMeta(body: unknown, partial = false): DocumentMetaInput {
  const raw = body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {};
  // multipart bodies arrive with a null prototype in some multer versions
  const b = bodyObject(Object.assign({}, raw), ['title', 'categoryId', 'language', 'publication', 'sourceName']);
  const out: DocumentMetaInput = {};
  if ('title' in b) out.title = text(b.title, 200, { min: 1 }) as string;
  if ('categoryId' in b) out.categoryId = uuid(b.categoryId);
  else if (!partial) invalid();
  if ('language' in b) out.language = oneOf(b.language, KNOWLEDGE_LANGUAGES);
  if ('publication' in b) out.publication = oneOf(b.publication, PUBLICATIONS);
  if ('sourceName' in b) out.sourceName = text(b.sourceName, 200, { nullable: true });
  if (partial && Object.keys(out).length === 0) invalid();
  return out;
}

export function parseId(id: string): string {
  return isUuidv7(id) ? id : invalid();
}
