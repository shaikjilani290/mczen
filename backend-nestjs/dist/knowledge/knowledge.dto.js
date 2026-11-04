"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SEARCH_LIMIT = exports.MAX_PAGE_SIZE = exports.MAX_TAGS = exports.MAX_ARTICLE_CONTENT = exports.DEFAULT_CATEGORIES = exports.DOCUMENT_STATUSES = exports.PUBLICATIONS = exports.ARTICLE_STATUSES = exports.KNOWLEDGE_LANGUAGES = void 0;
exports.parseTags = parseTags;
exports.parseCategory = parseCategory;
exports.parseArticle = parseArticle;
exports.parseArticleQuery = parseArticleQuery;
exports.parseDocumentQuery = parseDocumentQuery;
exports.parseSearchQuery = parseSearchQuery;
exports.parseDocumentMeta = parseDocumentMeta;
exports.parseId = parseId;
const common_1 = require("@nestjs/common");
const auth_dto_1 = require("../auth/auth.dto");
const uuid_1 = require("../common/ids/uuid");
const text_utils_1 = require("./text-utils");
exports.KNOWLEDGE_LANGUAGES = ['en', 'hi', 'te'];
exports.ARTICLE_STATUSES = ['draft', 'published', 'archived'];
exports.PUBLICATIONS = ['draft', 'published'];
exports.DOCUMENT_STATUSES = ['pending', 'processing', 'processed', 'failed', 'archived'];
exports.DEFAULT_CATEGORIES = [
    { slug: 'symptoms', name: 'Symptoms' },
    { slug: 'nutrition', name: 'Nutrition' },
    { slug: 'fitness', name: 'Fitness' },
    { slug: 'sleep-wellness', name: 'Sleep & Wellness' },
    { slug: 'mczen-products', name: 'McZEN Products' },
    { slug: 'health-education', name: 'Health Education' },
];
exports.MAX_ARTICLE_CONTENT = 200_000;
exports.MAX_TAGS = 10;
exports.MAX_PAGE_SIZE = 50;
exports.MAX_SEARCH_LIMIT = 20;
const invalid = () => {
    throw new common_1.BadRequestException('Invalid request.');
};
function text(v, max, opts = {}) {
    if (v === null && opts.nullable)
        return null;
    if (typeof v !== 'string')
        return invalid();
    const s = (0, text_utils_1.sanitizeText)(v);
    if (s.length < (opts.min ?? 0) || s.length > max)
        return invalid();
    if (s === '' && opts.nullable)
        return null;
    return s;
}
function oneOf(v, allowed) {
    return typeof v === 'string' && allowed.includes(v) ? v : invalid();
}
function webUrl(v) {
    const s = text(v, 500, { nullable: true });
    if (s === null)
        return null;
    try {
        const u = new URL(s);
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
            return invalid();
    }
    catch {
        return invalid();
    }
    return s;
}
function parseTags(v) {
    if (!Array.isArray(v) || v.length > exports.MAX_TAGS)
        return invalid();
    const tags = v.map((tag) => text(tag, 50, { min: 1 }).toLowerCase());
    return [...new Set(tags)];
}
function uuid(v) {
    return (0, uuid_1.isUuidv7)(v) ? v : invalid();
}
function parseCategory(body, partial = false) {
    const b = (0, auth_dto_1.bodyObject)(body, ['name', 'description']);
    const out = {};
    if (!partial || 'name' in b)
        out.name = text(b.name, 100, { min: 1 });
    if ('description' in b)
        out.description = text(b.description, 500, { nullable: true });
    if (partial && Object.keys(out).length === 0)
        invalid();
    return out;
}
const ARTICLE_KEYS = ['title', 'summary', 'content', 'categoryId', 'language', 'status', 'tags', 'sourceName', 'sourceUrl', 'referenceNote'];
function parseArticle(body, partial = false) {
    const b = (0, auth_dto_1.bodyObject)(body, ARTICLE_KEYS);
    const out = {};
    const need = (key) => !partial || key in b;
    if (need('title'))
        out.title = text(b.title, 200, { min: 1 });
    if (need('content'))
        out.content = text(b.content, exports.MAX_ARTICLE_CONTENT, { min: 1 });
    if (need('categoryId'))
        out.categoryId = uuid(b.categoryId);
    if ('language' in b || !partial)
        out.language = 'language' in b ? oneOf(b.language, exports.KNOWLEDGE_LANGUAGES) : 'en';
    if ('status' in b)
        out.status = oneOf(b.status, exports.PUBLICATIONS);
    else if (!partial)
        out.status = 'draft';
    if ('tags' in b)
        out.tags = parseTags(b.tags);
    else if (!partial)
        out.tags = [];
    if ('summary' in b)
        out.summary = text(b.summary, 1000, { nullable: true });
    if ('sourceName' in b)
        out.sourceName = text(b.sourceName, 200, { nullable: true });
    if ('sourceUrl' in b)
        out.sourceUrl = webUrl(b.sourceUrl);
    if ('referenceNote' in b)
        out.referenceNote = text(b.referenceNote, 500, { nullable: true });
    if (partial && Object.keys(out).length === 0)
        invalid();
    return out;
}
function intParam(v, def, min, max) {
    if (v === undefined || v === '')
        return def;
    if (typeof v !== 'string' || !/^\d{1,6}$/.test(v))
        return invalid();
    const n = Number(v);
    return n < min || n > max ? invalid() : n;
}
function queryObject(q, allowed) {
    if (!q || typeof q !== 'object')
        return {};
    const obj = q;
    if (Object.keys(obj).some((key) => !allowed.includes(key)))
        return invalid();
    return obj;
}
function optionalString(v, max) {
    if (v === undefined || v === '')
        return undefined;
    if (typeof v !== 'string' || v.length > max)
        return invalid();
    return (0, text_utils_1.sanitizeText)(v);
}
function parseArticleQuery(raw) {
    const q = queryObject(raw, ['status', 'categoryId', 'language', 'tag', 'q', 'page', 'pageSize']);
    const out = { page: intParam(q.page, 1, 1, 10000), pageSize: intParam(q.pageSize, 20, 1, exports.MAX_PAGE_SIZE) };
    if (q.status)
        out.status = oneOf(q.status, exports.ARTICLE_STATUSES);
    if (q.categoryId)
        out.categoryId = uuid(q.categoryId);
    if (q.language)
        out.language = oneOf(q.language, exports.KNOWLEDGE_LANGUAGES);
    out.tag = optionalString(q.tag, 50)?.toLowerCase();
    out.q = optionalString(q.q, 200);
    return out;
}
function parseDocumentQuery(raw) {
    const q = queryObject(raw, ['status', 'categoryId', 'language', 'q', 'page', 'pageSize']);
    const out = { page: intParam(q.page, 1, 1, 10000), pageSize: intParam(q.pageSize, 20, 1, exports.MAX_PAGE_SIZE) };
    if (q.status)
        out.status = oneOf(q.status, exports.DOCUMENT_STATUSES);
    if (q.categoryId)
        out.categoryId = uuid(q.categoryId);
    if (q.language)
        out.language = oneOf(q.language, exports.KNOWLEDGE_LANGUAGES);
    out.q = optionalString(q.q, 200);
    return out;
}
function parseSearchQuery(raw) {
    const q = queryObject(raw, ['q', 'categoryId', 'language', 'limit']);
    const term = optionalString(q.q, 500);
    if (!term)
        return invalid();
    const out = { q: term, limit: intParam(q.limit, 8, 1, exports.MAX_SEARCH_LIMIT) };
    if (q.categoryId)
        out.categoryId = uuid(q.categoryId);
    if (q.language)
        out.language = oneOf(q.language, exports.KNOWLEDGE_LANGUAGES);
    return out;
}
function parseDocumentMeta(body, partial = false) {
    const raw = body && typeof body === 'object' ? { ...body } : {};
    const b = (0, auth_dto_1.bodyObject)(Object.assign({}, raw), ['title', 'categoryId', 'language', 'publication', 'sourceName']);
    const out = {};
    if ('title' in b)
        out.title = text(b.title, 200, { min: 1 });
    if ('categoryId' in b)
        out.categoryId = uuid(b.categoryId);
    else if (!partial)
        invalid();
    if ('language' in b)
        out.language = oneOf(b.language, exports.KNOWLEDGE_LANGUAGES);
    if ('publication' in b)
        out.publication = oneOf(b.publication, exports.PUBLICATIONS);
    if ('sourceName' in b)
        out.sourceName = text(b.sourceName, 200, { nullable: true });
    if (partial && Object.keys(out).length === 0)
        invalid();
    return out;
}
function parseId(id) {
    return (0, uuid_1.isUuidv7)(id) ? id : invalid();
}
//# sourceMappingURL=knowledge.dto.js.map