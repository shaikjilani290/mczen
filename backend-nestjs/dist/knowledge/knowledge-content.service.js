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
exports.KnowledgeContentService = void 0;
exports.toCategory = toCategory;
exports.toArticleSummary = toArticleSummary;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
const knowledge_retriever_1 = require("./knowledge-retriever");
const knowledge_repository_1 = require("./knowledge.repository");
const text_utils_1 = require("./text-utils");
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
const uid = (v) => (v ? (0, uuid_1.binaryToUuid)(v) : null);
function toCategory(r) {
    return {
        id: uid(r.id), name: r.name, slug: r.slug, description: r.description ?? null, isSystem: Boolean(r.is_system),
        articleCount: Number(r.article_count ?? 0), documentCount: Number(r.document_count ?? 0),
    };
}
function toArticleSummary(r, tags = []) {
    return {
        id: uid(r.id), title: r.title, summary: r.summary ?? null, language: r.language_code, status: r.status,
        categoryId: uid(r.category_id), categoryName: r.category_name, tags,
        createdBy: uid(r.created_by), updatedBy: uid(r.updated_by),
        createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), publishedAt: iso(r.published_at),
    };
}
let KnowledgeContentService = class KnowledgeContentService {
    repo;
    retriever;
    constructor(repo, retriever) {
        this.repo = repo;
        this.retriever = retriever;
    }
    async listCategories() {
        await this.repo.ensureDefaultCategories();
        return { categories: (await this.repo.listCategories()).map(toCategory) };
    }
    async createCategory(input) {
        await this.repo.ensureDefaultCategories();
        const id = await this.repo.insertCategory(input.name, (0, text_utils_1.slugify)(input.name), input.description ?? null);
        return toCategory(await this.repo.findCategory((0, uuid_1.binaryToUuid)(id)));
    }
    async updateCategory(id, input) {
        const existing = await this.repo.findCategory(id);
        if (existing.is_system && input.name !== undefined && input.name !== existing.name) {
            throw new common_1.ConflictException('Built-in categories cannot be renamed.');
        }
        await this.repo.updateCategory(id, {
            name: input.name,
            slug: input.name !== undefined ? (0, text_utils_1.slugify)(input.name) : undefined,
            description: input.description,
        });
        return toCategory(await this.repo.findCategory(id));
    }
    async deleteCategory(id) {
        const existing = await this.repo.findCategory(id);
        if (existing.is_system)
            throw new common_1.ConflictException('Built-in categories cannot be deleted.');
        if ((await this.repo.categoryUsage(id)) > 0)
            throw new common_1.ConflictException('Move or remove the articles and documents in this category first.');
        await this.repo.deleteCategory(id);
        return { deleted: true };
    }
    async articleView(id) {
        const row = await this.repo.findArticle(id);
        const tags = (await this.repo.tagsFor([row.id])).map((t) => String(t.tag));
        return {
            ...toArticleSummary(row, tags),
            content: row.content,
            sourceName: row.source_name ?? null,
            sourceUrl: row.source_url ?? null,
            referenceNote: row.reference_note ?? null,
        };
    }
    chunksFor(article) {
        const body = [article.title, article.summary ?? '', article.content].filter(Boolean).join('\n\n');
        return (0, text_utils_1.chunkText)(body);
    }
    async createArticle(input, userId) {
        await this.repo.ensureDefaultCategories();
        await this.repo.findCategory(input.categoryId);
        const id = (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)());
        const user = (0, uuid_1.uuidToBinary)(userId);
        await this.repo.transaction(async (manager) => {
            await this.repo.insertArticle(manager, {
                id, categoryId: (0, uuid_1.uuidToBinary)(input.categoryId), title: input.title, summary: input.summary ?? null,
                content: input.content, language: input.language, status: input.status,
                sourceName: input.sourceName ?? null, sourceUrl: input.sourceUrl ?? null, referenceNote: input.referenceNote ?? null, userId: user,
            });
            await this.repo.replaceTags(manager, id, input.tags ?? []);
            await this.repo.replaceChunks(manager, { articleId: id }, this.chunksFor({ title: input.title, summary: input.summary, content: input.content }), input.language);
        });
        return this.articleView((0, uuid_1.binaryToUuid)(id));
    }
    async listArticles(query) {
        await this.repo.ensureDefaultCategories();
        const { rows, total } = await this.repo.listArticles(query);
        const tags = await this.repo.tagsFor(rows.map((r) => r.id));
        const byArticle = new Map();
        for (const t of tags) {
            const key = uid(t.article_id);
            byArticle.set(key, [...(byArticle.get(key) ?? []), String(t.tag)]);
        }
        return {
            items: rows.map((r) => toArticleSummary(r, byArticle.get(uid(r.id)) ?? [])),
            page: query.page, pageSize: query.pageSize, total,
        };
    }
    getArticle(id) {
        return this.articleView(id);
    }
    async updateArticle(id, input, userId) {
        await this.repo.transaction(async (manager) => {
            const current = await this.repo.findArticle(id, manager, true);
            if (input.categoryId)
                await this.repo.findCategory(input.categoryId, manager);
            const fields = { ...input, updatedBy: (0, uuid_1.uuidToBinary)(userId) };
            delete fields.tags;
            if (input.categoryId)
                fields.categoryId = (0, uuid_1.uuidToBinary)(input.categoryId);
            const publishing = input.status === 'published';
            await this.repo.updateArticle(manager, current.id, fields, publishing);
            if (input.tags)
                await this.repo.replaceTags(manager, current.id, input.tags);
            const contentChanged = ['title', 'summary', 'content'].some((k) => k in input);
            const language = (input.language ?? current.language_code);
            if (contentChanged) {
                const next = {
                    title: (input.title ?? current.title),
                    summary: (input.summary !== undefined ? input.summary : current.summary),
                    content: (input.content ?? current.content),
                };
                await this.repo.replaceChunks(manager, { articleId: current.id }, this.chunksFor(next), language);
            }
            else if (input.language) {
                await this.repo.setChunkLanguage(manager, { articleId: current.id }, language);
            }
        });
        return this.articleView(id);
    }
    async archiveArticle(id, userId) {
        await this.repo.transaction(async (manager) => {
            const current = await this.repo.findArticle(id, manager, true);
            await this.repo.updateArticle(manager, current.id, { status: 'archived', updatedBy: (0, uuid_1.uuidToBinary)(userId) }, false);
        });
        return this.articleView(id);
    }
    async dashboard() {
        await this.repo.ensureDefaultCategories();
        const c = await this.repo.dashboardCounts();
        const articlesByStatus = { draft: 0, published: 0, archived: 0 };
        const articlesByLanguage = { en: 0, hi: 0, te: 0 };
        for (const r of c.articles) {
            articlesByStatus[String(r.status)] += Number(r.n);
            if (r.status !== 'archived')
                articlesByLanguage[String(r.language_code)] += Number(r.n);
        }
        const documentsByStatus = { pending: 0, processing: 0, processed: 0, failed: 0, archived: 0 };
        for (const r of c.documents)
            documentsByStatus[String(r.status)] = Number(r.n);
        return {
            articlesByStatus, articlesByLanguage, documentsByStatus, categoryCount: c.categories,
            recentArticles: c.recent.map((r) => ({ id: uid(r.id), title: r.title, status: r.status, language: r.language_code, updatedAt: iso(r.updated_at) })),
        };
    }
    async search(query) {
        const hits = await this.retriever.search({ query: query.q, categoryId: query.categoryId, language: query.language, limit: query.limit });
        return { query: query.q, results: hits };
    }
};
exports.KnowledgeContentService = KnowledgeContentService;
exports.KnowledgeContentService = KnowledgeContentService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(knowledge_retriever_1.KNOWLEDGE_RETRIEVER)),
    __metadata("design:paramtypes", [knowledge_repository_1.KnowledgeRepository, Object])
], KnowledgeContentService);
//# sourceMappingURL=knowledge-content.service.js.map