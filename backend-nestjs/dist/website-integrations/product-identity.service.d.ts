import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { WebsiteIntegrationRepository } from './website-integration.repository';
export interface ProductIdentity {
    externalProductId: string;
    name: string;
}
export declare function normalizeProductName(name: string): string;
export declare function productMentions(text: string, vocabulary: readonly ProductIdentity[]): ProductIdentity[];
export declare class ProductIdentityService {
    private readonly repository;
    constructor(repository: WebsiteIntegrationRepository);
    vocabulary(context: AgentExecutionContext): Promise<ProductIdentity[]>;
}
