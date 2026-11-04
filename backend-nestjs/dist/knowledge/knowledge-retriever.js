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
exports.MysqlKnowledgeRetriever = exports.EXCERPT_CHARS = exports.KNOWLEDGE_RETRIEVER = void 0;
exports.termOverlap = termOverlap;
exports.rankHits = rankHits;
exports.buildMatchQuery = buildMatchQuery;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
const knowledge_repository_1 = require("./knowledge.repository");
const text_utils_1 = require("./text-utils");
exports.KNOWLEDGE_RETRIEVER = Symbol('KNOWLEDGE_RETRIEVER');
exports.EXCERPT_CHARS = 600;
const OVERFETCH = 40;
function excerpt(content) {
    return content.length <= exports.EXCERPT_CHARS ? content : `${content.slice(0, exports.EXCERPT_CHARS).trimEnd()}…`;
}
function termOverlap(terms, text) {
    if (terms.length === 0)
        return 0;
    const haystack = text.normalize('NFC').toLowerCase();
    return terms.filter((term) => haystack.includes(term)).length / terms.length;
}
function rankHits(rows, query, limit) {
    const terms = (0, text_utils_1.tokenize)(query);
    const maxScore = Math.max(...rows.map((r) => Number(r.score) || 0), 0) || 1;
    const best = new Map();
    for (const row of rows) {
        const content = String(row.content ?? '');
        const isArticle = row.article_id != null;
        const title = String(isArticle ? row.article_title : row.document_title);
        const overlap = termOverlap(terms, content);
        const titleOverlap = termOverlap(terms, title);
        if (overlap === 0 && titleOverlap === 0)
            continue;
        const sourceId = (0, uuid_1.binaryToUuid)((isArticle ? row.article_id : row.document_id));
        const kind = isArticle ? 'article' : 'document';
        const score = 0.5 * ((Number(row.score) || 0) / maxScore) + 0.4 * overlap + 0.1 * titleOverlap;
        const key = `${kind}:${sourceId}`;
        if ((best.get(key)?.score ?? -1) >= score)
            continue;
        const sourceUrl = isArticle ? row.article_source_url : null;
        best.set(key, {
            kind,
            sourceId,
            title,
            category: row.category_name ?? null,
            language: String(row.language_code),
            excerpt: excerpt(content),
            score: Math.round(score * 1000) / 1000,
            source: sourceUrl || `knowledge://${kind}/${sourceId}`,
            sourceName: (isArticle ? row.article_source_name : row.document_source_name) ?? null,
            sourceUrl,
        });
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
function buildMatchQuery(query) {
    return (0, text_utils_1.tokenize)(query).join(' ');
}
let MysqlKnowledgeRetriever = class MysqlKnowledgeRetriever {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async search(params) {
        const match = buildMatchQuery(params.query);
        if (!match)
            return [];
        const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
        const rows = await this.repository.searchChunks({
            match,
            categoryId: params.categoryId,
            language: params.language,
            limit: Math.max(OVERFETCH, limit * 4),
        });
        return rankHits(rows, params.query, limit);
    }
};
exports.MysqlKnowledgeRetriever = MysqlKnowledgeRetriever;
exports.MysqlKnowledgeRetriever = MysqlKnowledgeRetriever = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [knowledge_repository_1.KnowledgeRepository])
], MysqlKnowledgeRetriever);
//# sourceMappingURL=knowledge-retriever.js.map