import { DataSource, EntityManager, ObjectLiteral } from 'typeorm';
import { TenantScopedRepository } from '../common/tenant/tenant-scoped.repository';
import { ArticleQuery, DocumentQuery } from './knowledge.dto';
export type Row = Record<string, unknown>;
export interface ChunkParent {
    articleId?: Buffer;
    documentId?: Buffer;
}
export interface RawSearchParams {
    match: string;
    categoryId?: string;
    language?: string;
    limit: number;
}
export declare class KnowledgeRepository extends TenantScopedRepository<ObjectLiteral> {
    private readonly source?;
    constructor(source?: DataSource | undefined);
    private get database();
    transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T>;
    tenantBinary(): Buffer;
    tenantIdString(): string;
    private run;
    idBinary(id: string, what: string): Buffer;
    ensureDefaultCategories(): Promise<void>;
    listCategories(): Promise<Row[]>;
    findCategory(id: string, manager?: EntityManager): Promise<Row>;
    insertCategory(name: string, slug: string, description: string | null): Promise<Buffer>;
    updateCategory(id: string, fields: {
        name?: string;
        slug?: string;
        description?: string | null;
    }): Promise<void>;
    categoryUsage(id: string): Promise<number>;
    deleteCategory(id: string): Promise<void>;
    insertArticle(manager: EntityManager, a: {
        id: Buffer;
        categoryId: Buffer;
        title: string;
        summary: string | null;
        content: string;
        language: string;
        status: string;
        sourceName: string | null;
        sourceUrl: string | null;
        referenceNote: string | null;
        userId: Buffer | null;
    }): Promise<void>;
    updateArticle(manager: EntityManager, id: Buffer, fields: Record<string, unknown>, publishing: boolean): Promise<void>;
    findArticle(id: string, manager?: EntityManager, lock?: boolean): Promise<Row>;
    listArticles(q: ArticleQuery): Promise<{
        rows: Row[];
        total: number;
    }>;
    tagsFor(articleIds: Buffer[]): Promise<Row[]>;
    replaceTags(manager: EntityManager, articleId: Buffer, tags: string[]): Promise<void>;
    replaceChunks(manager: EntityManager | undefined, parent: ChunkParent, chunks: string[], language: string): Promise<void>;
    setChunkLanguage(manager: EntityManager, parent: ChunkParent, language: string): Promise<void>;
    insertDocument(d: {
        id: Buffer;
        categoryId: Buffer;
        title: string;
        filename: string;
        fileType: string;
        byteSize: number;
        hash: string;
        storageKey: string;
        language: string;
        publication: string;
        sourceName: string | null;
        userId: Buffer;
    }): Promise<void>;
    updateDocument(id: Buffer, fields: Record<string, unknown>, rawSets?: string[]): Promise<void>;
    findDocument(id: string): Promise<Row>;
    listDocuments(q: DocumentQuery): Promise<{
        rows: Row[];
        total: number;
    }>;
    dashboardCounts(): Promise<{
        articles: Row[];
        documents: Row[];
        categories: number;
        recent: Row[];
    }>;
    searchChunks(p: RawSearchParams): Promise<Row[]>;
}
