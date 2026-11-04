import type { KnowledgeRetriever } from '../knowledge/knowledge-retriever';
export interface KnowledgeDocument {
    id: string;
    title: string;
    content: string;
    source: string;
}
export declare class KnowledgeService {
    private readonly retriever?;
    constructor(retriever?: KnowledgeRetriever | undefined);
    search(query: string, context?: {
        tenantId: string;
    }): KnowledgeDocument[] | Promise<KnowledgeDocument[]>;
    private searchTenantKnowledge;
    private readonly documents;
    private searchDemo;
}
