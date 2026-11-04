export declare const KNOWLEDGE_LANGUAGES: readonly ["en", "hi", "te"];
export type KnowledgeLanguage = (typeof KNOWLEDGE_LANGUAGES)[number];
export declare const ARTICLE_STATUSES: readonly ["draft", "published", "archived"];
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export declare const PUBLICATIONS: readonly ["draft", "published"];
export type Publication = (typeof PUBLICATIONS)[number];
export declare const DOCUMENT_STATUSES: readonly ["pending", "processing", "processed", "failed", "archived"];
export declare const DEFAULT_CATEGORIES: readonly [{
    readonly slug: "symptoms";
    readonly name: "Symptoms";
}, {
    readonly slug: "nutrition";
    readonly name: "Nutrition";
}, {
    readonly slug: "fitness";
    readonly name: "Fitness";
}, {
    readonly slug: "sleep-wellness";
    readonly name: "Sleep & Wellness";
}, {
    readonly slug: "mczen-products";
    readonly name: "McZEN Products";
}, {
    readonly slug: "health-education";
    readonly name: "Health Education";
}];
export declare const MAX_ARTICLE_CONTENT = 200000;
export declare const MAX_TAGS = 10;
export declare const MAX_PAGE_SIZE = 50;
export declare const MAX_SEARCH_LIMIT = 20;
export declare function parseTags(v: unknown): string[];
export interface CategoryInput {
    name: string;
    description?: string | null;
}
export declare function parseCategory(body: unknown, partial?: boolean): Partial<CategoryInput>;
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
export declare function parseArticle(body: unknown, partial?: boolean): Partial<ArticleInput>;
export interface Page {
    page: number;
    pageSize: number;
}
export interface ArticleQuery extends Page {
    status?: ArticleStatus;
    categoryId?: string;
    language?: KnowledgeLanguage;
    tag?: string;
    q?: string;
}
export declare function parseArticleQuery(raw: unknown): ArticleQuery;
export interface DocumentQuery extends Page {
    status?: (typeof DOCUMENT_STATUSES)[number];
    categoryId?: string;
    language?: KnowledgeLanguage;
    q?: string;
}
export declare function parseDocumentQuery(raw: unknown): DocumentQuery;
export interface SearchQuery {
    q: string;
    categoryId?: string;
    language?: KnowledgeLanguage;
    limit: number;
}
export declare function parseSearchQuery(raw: unknown): SearchQuery;
export interface DocumentMetaInput {
    title?: string;
    categoryId?: string;
    language?: KnowledgeLanguage;
    publication?: Publication;
    sourceName?: string | null;
}
export declare function parseDocumentMeta(body: unknown, partial?: boolean): DocumentMetaInput;
export declare function parseId(id: string): string;
