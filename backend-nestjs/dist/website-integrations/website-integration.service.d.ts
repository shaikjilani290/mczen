import type { DataSource } from 'typeorm';
import { KnowledgeRepository } from '../knowledge/knowledge.repository';
import { type SharedState } from '../shared-state/shared-state';
import { ToolConfigurationRepository } from '../tools/tool-configuration.repository';
import { WebsiteIntegrationRepository } from './website-integration.repository';
export declare class WebsiteIntegrationService {
    private readonly integrations;
    private readonly knowledge;
    private readonly database;
    private readonly toolConfiguration?;
    private readonly logger;
    private readonly limiter;
    private readonly crawler;
    constructor(integrations: WebsiteIntegrationRepository, knowledge: KnowledgeRepository, database: DataSource, sharedState?: SharedState, toolConfiguration?: ToolConfigurationRepository | undefined);
    private tenant;
    create(input: {
        name: string;
        origin: string;
        assistantId: string;
    }, userId: string): Promise<{
        integration: {
            [x: string]: unknown;
        };
        ingestionKey: string;
    }>;
    list(): Promise<{
        [x: string]: unknown;
    }[]>;
    status(integrationId: string): Promise<{
        [x: string]: unknown;
    }>;
    rotateKeys(integrationId: string): Promise<{
        publicKey: string;
        ingestionKey: string;
    }>;
    revoke(integrationId: string): Promise<{
        id: string;
        status: "revoked";
    }>;
    beginSync(integrationId: string): Promise<{
        id: string;
        syncStatus: "running";
    }>;
    private runSync;
    private deactivateMissingPages;
    pages(integrationId: string, page: number, pageSize: number): Promise<{
        [x: string]: unknown;
    }[]>;
    products(integrationId: string, page: number, pageSize: number): Promise<{
        [x: string]: unknown;
    }[]>;
    knowledgeList(integrationId: string, page: number, pageSize: number): Promise<{
        [x: string]: unknown;
    }[]>;
    rebuildIndex(integrationId: string): Promise<{
        id: string;
        status: "completed";
        indexed: number;
    }>;
    private authenticateIngestion;
    ingestPages(key: string | undefined, body: unknown): Promise<{
        accepted: number;
        indexed: number;
    }>;
    ingestProducts(key: string | undefined, body: unknown): Promise<{
        accepted: number;
    }>;
    ingestBatch(key: string | undefined, body: unknown): Promise<{
        accepted: {
            pages: number;
            products: number;
        };
        indexed: number;
    }>;
    private withIntegrationContext;
    private savePage;
    private saveProduct;
    toolSearchPages(context: {
        tenantId: string;
        assistantId?: string;
    }, query: string, type: string | null, limit: number): Promise<{
        [x: string]: unknown;
    }[]>;
    toolSearchProducts(context: {
        tenantId: string;
        assistantId?: string;
    }, input: {
        query?: string;
        category?: string;
        limit: number;
        ids?: string[];
    }): Promise<{
        [x: string]: unknown;
    }[]>;
}
