import { ArticleInput, ArticleQuery, CategoryInput, SearchQuery } from './knowledge.dto';
import type { KnowledgeRetriever } from './knowledge-retriever';
import { KnowledgeRepository, Row } from './knowledge.repository';
export declare function toCategory(r: Row): {
    id: string | null;
    name: unknown;
    slug: unknown;
    description: {} | null;
    isSystem: boolean;
    articleCount: number;
    documentCount: number;
};
export declare function toArticleSummary(r: Row, tags?: string[]): {
    id: string | null;
    title: unknown;
    summary: {} | null;
    language: unknown;
    status: unknown;
    categoryId: string | null;
    categoryName: unknown;
    tags: string[];
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    publishedAt: string | null;
};
export declare class KnowledgeContentService {
    private readonly repo;
    private readonly retriever;
    constructor(repo: KnowledgeRepository, retriever: KnowledgeRetriever);
    listCategories(): Promise<{
        categories: {
            id: string | null;
            name: unknown;
            slug: unknown;
            description: {} | null;
            isSystem: boolean;
            articleCount: number;
            documentCount: number;
        }[];
    }>;
    createCategory(input: Partial<CategoryInput>): Promise<{
        id: string | null;
        name: unknown;
        slug: unknown;
        description: {} | null;
        isSystem: boolean;
        articleCount: number;
        documentCount: number;
    }>;
    updateCategory(id: string, input: Partial<CategoryInput>): Promise<{
        id: string | null;
        name: unknown;
        slug: unknown;
        description: {} | null;
        isSystem: boolean;
        articleCount: number;
        documentCount: number;
    }>;
    deleteCategory(id: string): Promise<{
        deleted: boolean;
    }>;
    private articleView;
    private chunksFor;
    createArticle(input: Partial<ArticleInput>, userId: string): Promise<{
        content: unknown;
        sourceName: {} | null;
        sourceUrl: {} | null;
        referenceNote: {} | null;
        id: string | null;
        title: unknown;
        summary: {} | null;
        language: unknown;
        status: unknown;
        categoryId: string | null;
        categoryName: unknown;
        tags: string[];
        createdBy: string | null;
        updatedBy: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        publishedAt: string | null;
    }>;
    listArticles(query: ArticleQuery): Promise<{
        items: {
            id: string | null;
            title: unknown;
            summary: {} | null;
            language: unknown;
            status: unknown;
            categoryId: string | null;
            categoryName: unknown;
            tags: string[];
            createdBy: string | null;
            updatedBy: string | null;
            createdAt: string | null;
            updatedAt: string | null;
            publishedAt: string | null;
        }[];
        page: number;
        pageSize: number;
        total: number;
    }>;
    getArticle(id: string): Promise<{
        content: unknown;
        sourceName: {} | null;
        sourceUrl: {} | null;
        referenceNote: {} | null;
        id: string | null;
        title: unknown;
        summary: {} | null;
        language: unknown;
        status: unknown;
        categoryId: string | null;
        categoryName: unknown;
        tags: string[];
        createdBy: string | null;
        updatedBy: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        publishedAt: string | null;
    }>;
    updateArticle(id: string, input: Partial<ArticleInput>, userId: string): Promise<{
        content: unknown;
        sourceName: {} | null;
        sourceUrl: {} | null;
        referenceNote: {} | null;
        id: string | null;
        title: unknown;
        summary: {} | null;
        language: unknown;
        status: unknown;
        categoryId: string | null;
        categoryName: unknown;
        tags: string[];
        createdBy: string | null;
        updatedBy: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        publishedAt: string | null;
    }>;
    archiveArticle(id: string, userId: string): Promise<{
        content: unknown;
        sourceName: {} | null;
        sourceUrl: {} | null;
        referenceNote: {} | null;
        id: string | null;
        title: unknown;
        summary: {} | null;
        language: unknown;
        status: unknown;
        categoryId: string | null;
        categoryName: unknown;
        tags: string[];
        createdBy: string | null;
        updatedBy: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        publishedAt: string | null;
    }>;
    dashboard(): Promise<{
        articlesByStatus: Record<string, number>;
        articlesByLanguage: Record<string, number>;
        documentsByStatus: Record<string, number>;
        categoryCount: number;
        recentArticles: {
            id: string | null;
            title: unknown;
            status: unknown;
            language: unknown;
            updatedAt: string | null;
        }[];
    }>;
    search(query: SearchQuery): Promise<{
        query: string;
        results: import("./knowledge-retriever").KnowledgeHit[];
    }>;
}
