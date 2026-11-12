import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { MerchantCartService } from './merchant-cart.service';
import { WebsiteIntegrationRepository } from './website-integration.repository';
export interface WebsiteKnowledgeAnswer {
    answer: string;
    toolCalls: Array<{
        name: string;
        resultCount: number;
    }>;
    sources: Array<{
        id: string;
        title: string;
        source: string;
    }>;
    products: Array<{
        externalProductId: string;
        name: string;
        productUrl: string;
        images: string[];
        price: number | null;
        salePrice: number | null;
        currency: string | null;
    }>;
}
export declare class WebsiteKnowledgeEngine {
    private readonly repository;
    private readonly merchant?;
    constructor(repository: WebsiteIntegrationRepository, merchant?: MerchantCartService | undefined);
    answer(question: string, context: AgentExecutionContext, allowLlmFallback?: boolean): Promise<WebsiteKnowledgeAnswer | undefined>;
    private searchProducts;
    private resolveComparison;
    private searchPages;
    private answerProducts;
}
