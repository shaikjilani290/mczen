import { KnowledgeRepository, Row } from './knowledge.repository';
import { KnowledgeLanguage } from './knowledge.dto';
export declare const KNOWLEDGE_RETRIEVER: unique symbol;
export interface KnowledgeSearchParams {
    query: string;
    categoryId?: string;
    language?: KnowledgeLanguage;
    limit?: number;
}
export interface KnowledgeHit {
    kind: 'article' | 'document';
    sourceId: string;
    title: string;
    category: string | null;
    language: string;
    excerpt: string;
    score: number;
    source: string;
    sourceName: string | null;
    sourceUrl: string | null;
}
export interface KnowledgeRetriever {
    search(params: KnowledgeSearchParams): Promise<KnowledgeHit[]>;
}
export declare const EXCERPT_CHARS = 600;
export declare function termOverlap(terms: string[], text: string): number;
export declare function rankHits(rows: Row[], query: string, limit: number): KnowledgeHit[];
export declare function buildMatchQuery(query: string): string;
export declare class MysqlKnowledgeRetriever implements KnowledgeRetriever {
    private readonly repository;
    constructor(repository: KnowledgeRepository);
    search(params: KnowledgeSearchParams): Promise<KnowledgeHit[]>;
}
