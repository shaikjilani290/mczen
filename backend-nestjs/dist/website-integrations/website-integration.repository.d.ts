import type { DataSource, EntityManager } from 'typeorm';
import type { CreateWebsiteIntegrationInput, WebsitePageInput, WebsiteProductInput } from './website-integration.dto';
type Row = Record<string, unknown>;
export interface WebsiteIntegrationRecord {
    id: string;
    tenantId: string;
    assistantId: string;
    name: string;
    origin: string;
    publicKey: string;
    ingestionKeyHash: string;
    createdBy: string | null;
    status: 'active' | 'revoked';
}
export declare class WebsiteIntegrationRepository {
    private readonly database?;
    constructor(database?: DataSource | undefined);
    private get db();
    private run;
    assistantExists(tenantId: string, assistantId: string): Promise<boolean>;
    create(tenantId: string, input: CreateWebsiteIntegrationInput, publicKey: string, ingestionKeyHash: string, userId: string, manager?: EntityManager): Promise<void>;
    list(tenantId: string): Promise<Row[]>;
    get(tenantId: string, integrationId: string): Promise<Row>;
    private adminView;
    record(tenantId: string, integrationId: string, requireActive?: boolean): Promise<WebsiteIntegrationRecord>;
    byPublicKey(publicKey: string): Promise<WebsiteIntegrationRecord | undefined>;
    activeRecord(tenantId: string, integrationId: string): Promise<WebsiteIntegrationRecord | undefined>;
    byIngestionKey(key: string): Promise<WebsiteIntegrationRecord | undefined>;
    private recordView;
    rotateKeys(tenantId: string, integrationId: string, publicKey: string, ingestionKeyHash: string): Promise<void>;
    revoke(tenantId: string, integrationId: string): Promise<void>;
    beginSync(tenantId: string, integrationId: string): Promise<boolean>;
    setSyncDiscovery(tenantId: string, integrationId: string, count: number): Promise<void>;
    finishSync(tenantId: string, integrationId: string, result: {
        status: 'completed' | 'failed';
        pages: number;
        products: number;
        indexed: number;
        errors: string[];
    }): Promise<void>;
    refreshCounts(tenantId: string, integrationId: string): Promise<void>;
    findPage(tenantId: string, integrationId: string, urlHash: string, manager?: EntityManager): Promise<Row | undefined>;
    upsertPage(input: {
        tenantId: string;
        integrationId: string;
        articleId: Buffer;
        pageId: Buffer;
        url: string;
        urlHash: string;
        contentHash: string;
        page: WebsitePageInput;
    }, manager?: EntityManager): Promise<void>;
    pages(tenantId: string, integrationId: string, page?: number, pageSize?: number): Promise<Row[]>;
    upsertProduct(tenantId: string, integrationId: string, product: WebsiteProductInput, contentHash: string): Promise<void>;
    products(tenantId: string, integrationId: string, page?: number, pageSize?: number): Promise<Row[]>;
    private productView;
    trackPage(input: {
        tenantId: string;
        integrationId: string;
        visitorId: string;
        pageUrl: string;
        pageHash: string;
        title: string | null;
        referrer: string | null;
    }): Promise<void>;
    pageCounts(tenantId: string, integrationId: string): Promise<{
        pageViews: number;
    }>;
    searchPages(tenantId: string, assistantId: string, query: string, type: string | null, limit: number): Promise<Row[]>;
    searchProducts(tenantId: string, assistantId: string, input: {
        query?: string;
        category?: string;
        maxPrice?: number;
        currency?: string;
        limit: number;
        ids?: string[];
        integrationId?: string;
        productUrl?: string;
    }): Promise<Row[]>;
    productVocabulary(tenantId: string, assistantId: string, integrationId: string): Promise<Array<{
        externalProductId: string;
        name: string;
    }>>;
    listKnowledge(tenantId: string, integrationId: string, page?: number, pageSize?: number): Promise<Row[]>;
}
export {};
