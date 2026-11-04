import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { binaryToUuid, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import {
  ArticleInput, ArticleQuery, CategoryInput, SearchQuery,
} from './knowledge.dto';
import { KNOWLEDGE_RETRIEVER } from './knowledge-retriever';
import type { KnowledgeRetriever } from './knowledge-retriever';
import { KnowledgeRepository, Row } from './knowledge.repository';
import { chunkText, slugify } from './text-utils';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
const uid = (v: unknown): string | null => (v ? binaryToUuid(v as Uint8Array) : null);

export function toCategory(r: Row) {
  return {
    id: uid(r.id), name: r.name, slug: r.slug, description: r.description ?? null, isSystem: Boolean(r.is_system),
    articleCount: Number(r.article_count ?? 0), documentCount: Number(r.document_count ?? 0),
  };
}

export function toArticleSummary(r: Row, tags: string[] = []) {
  return {
    id: uid(r.id), title: r.title, summary: r.summary ?? null, language: r.language_code, status: r.status,
    categoryId: uid(r.category_id), categoryName: r.category_name, tags,
    createdBy: uid(r.created_by), updatedBy: uid(r.updated_by),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), publishedAt: iso(r.published_at),
  };
}

@Injectable()
export class KnowledgeContentService {
  constructor(
    private readonly repo: KnowledgeRepository,
    @Inject(KNOWLEDGE_RETRIEVER) private readonly retriever: KnowledgeRetriever,
  ) {}

  // ----- categories -----

  async listCategories() {
    await this.repo.ensureDefaultCategories();
    return { categories: (await this.repo.listCategories()).map(toCategory) };
  }

  async createCategory(input: Partial<CategoryInput>) {
    await this.repo.ensureDefaultCategories();
    const id = await this.repo.insertCategory(input.name as string, slugify(input.name as string), input.description ?? null);
    return toCategory(await this.repo.findCategory(binaryToUuid(id)));
  }

  async updateCategory(id: string, input: Partial<CategoryInput>) {
    const existing = await this.repo.findCategory(id);
    if (existing.is_system && input.name !== undefined && input.name !== existing.name) {
      throw new ConflictException('Built-in categories cannot be renamed.');
    }
    await this.repo.updateCategory(id, {
      name: input.name,
      slug: input.name !== undefined ? slugify(input.name) : undefined,
      description: input.description,
    });
    return toCategory(await this.repo.findCategory(id));
  }

  async deleteCategory(id: string) {
    const existing = await this.repo.findCategory(id);
    if (existing.is_system) throw new ConflictException('Built-in categories cannot be deleted.');
    if ((await this.repo.categoryUsage(id)) > 0) throw new ConflictException('Move or remove the articles and documents in this category first.');
    await this.repo.deleteCategory(id);
    return { deleted: true };
  }

  // ----- articles -----

  private async articleView(id: string) {
    const row = await this.repo.findArticle(id);
    const tags = (await this.repo.tagsFor([row.id as Buffer])).map((t) => String(t.tag));
    return {
      ...toArticleSummary(row, tags),
      content: row.content,
      sourceName: row.source_name ?? null,
      sourceUrl: row.source_url ?? null,
      referenceNote: row.reference_note ?? null,
    };
  }

  private chunksFor(article: { title: string; summary?: string | null; content: string }): string[] {
    const body = [article.title, article.summary ?? '', article.content].filter(Boolean).join('\n\n');
    return chunkText(body);
  }

  async createArticle(input: Partial<ArticleInput>, userId: string) {
    await this.repo.ensureDefaultCategories();
    await this.repo.findCategory(input.categoryId as string);
    const id = uuidToBinary(newUuidv7());
    const user = uuidToBinary(userId);
    await this.repo.transaction(async (manager) => {
      await this.repo.insertArticle(manager, {
        id, categoryId: uuidToBinary(input.categoryId as string), title: input.title as string, summary: input.summary ?? null,
        content: input.content as string, language: input.language as string, status: input.status as string,
        sourceName: input.sourceName ?? null, sourceUrl: input.sourceUrl ?? null, referenceNote: input.referenceNote ?? null, userId: user,
      });
      await this.repo.replaceTags(manager, id, input.tags ?? []);
      await this.repo.replaceChunks(manager, { articleId: id }, this.chunksFor({ title: input.title as string, summary: input.summary, content: input.content as string }), input.language as string);
    });
    return this.articleView(binaryToUuid(id));
  }

  async listArticles(query: ArticleQuery) {
    await this.repo.ensureDefaultCategories();
    const { rows, total } = await this.repo.listArticles(query);
    const tags = await this.repo.tagsFor(rows.map((r) => r.id as Buffer));
    const byArticle = new Map<string, string[]>();
    for (const t of tags) {
      const key = uid(t.article_id) as string;
      byArticle.set(key, [...(byArticle.get(key) ?? []), String(t.tag)]);
    }
    return {
      items: rows.map((r) => toArticleSummary(r, byArticle.get(uid(r.id) as string) ?? [])),
      page: query.page, pageSize: query.pageSize, total,
    };
  }

  getArticle(id: string) {
    return this.articleView(id);
  }

  async updateArticle(id: string, input: Partial<ArticleInput>, userId: string) {
    await this.repo.transaction(async (manager) => {
      const current = await this.repo.findArticle(id, manager, true);
      if (input.categoryId) await this.repo.findCategory(input.categoryId, manager);
      const fields: Record<string, unknown> = { ...input, updatedBy: uuidToBinary(userId) };
      delete fields.tags;
      if (input.categoryId) fields.categoryId = uuidToBinary(input.categoryId);
      // Editing an archived article keeps it archived unless a status is given.
      const publishing = input.status === 'published';
      await this.repo.updateArticle(manager, current.id as Buffer, fields, publishing);
      if (input.tags) await this.repo.replaceTags(manager, current.id as Buffer, input.tags);

      const contentChanged = ['title', 'summary', 'content'].some((k) => k in input);
      const language = (input.language ?? current.language_code) as string;
      if (contentChanged) {
        const next = {
          title: (input.title ?? current.title) as string,
          summary: (input.summary !== undefined ? input.summary : current.summary) as string | null,
          content: (input.content ?? current.content) as string,
        };
        await this.repo.replaceChunks(manager, { articleId: current.id as Buffer }, this.chunksFor(next), language);
      } else if (input.language) {
        await this.repo.setChunkLanguage(manager, { articleId: current.id as Buffer }, language);
      }
    });
    return this.articleView(id);
  }

  async archiveArticle(id: string, userId: string) {
    await this.repo.transaction(async (manager) => {
      const current = await this.repo.findArticle(id, manager, true);
      await this.repo.updateArticle(manager, current.id as Buffer, { status: 'archived', updatedBy: uuidToBinary(userId) }, false);
    });
    return this.articleView(id);
  }

  // ----- dashboard & search -----

  async dashboard() {
    await this.repo.ensureDefaultCategories();
    const c = await this.repo.dashboardCounts();
    const articlesByStatus: Record<string, number> = { draft: 0, published: 0, archived: 0 };
    const articlesByLanguage: Record<string, number> = { en: 0, hi: 0, te: 0 };
    for (const r of c.articles) {
      articlesByStatus[String(r.status)] += Number(r.n);
      if (r.status !== 'archived') articlesByLanguage[String(r.language_code)] += Number(r.n);
    }
    const documentsByStatus: Record<string, number> = { pending: 0, processing: 0, processed: 0, failed: 0, archived: 0 };
    for (const r of c.documents) documentsByStatus[String(r.status)] = Number(r.n);
    return {
      articlesByStatus, articlesByLanguage, documentsByStatus, categoryCount: c.categories,
      recentArticles: c.recent.map((r) => ({ id: uid(r.id), title: r.title, status: r.status, language: r.language_code, updatedAt: iso(r.updated_at) })),
    };
  }

  async search(query: SearchQuery) {
    const hits = await this.retriever.search({ query: query.q, categoryId: query.categoryId, language: query.language, limit: query.limit });
    return { query: query.q, results: hits };
  }
}
