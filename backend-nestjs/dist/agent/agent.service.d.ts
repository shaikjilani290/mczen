import { type AgentExecutionContext } from './context/agent-execution-context.interface';
import { AgentRuntimeConfigService } from './config/agent-runtime-config.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { ToolPermissionService } from './tools/tool-permission.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MerchantCartService, type VerifiedCartOperation } from '../website-integrations/merchant-cart.service';
import { ProductIdentityService } from '../website-integrations/product-identity.service';
import { WebsiteKnowledgeEngine } from '../website-integrations/website-knowledge.engine';
export interface AgentTurnOptions {
    signal?: AbortSignal;
    onText?: (text: string) => void;
}
export interface AgentResponse extends Partial<VerifiedCartOperation> {
    success: boolean;
    answer: string;
    model: string;
    toolCalls: Array<{
        name: string;
        resultCount: number;
    }>;
    sources: Array<{
        id: string;
        title: string;
        source: string;
    }>;
    products?: AgentProductCard[];
    cartOperation?: VerifiedCartOperation;
    navigationAction?: VerifiedCartOperation['navigationAction'];
}
export interface AgentProductCard {
    externalProductId: string;
    name: string;
    productUrl: string;
    images: string[];
    price: number | null;
    salePrice: number | null;
    currency: string | null;
}
export declare class AgentService {
    private readonly toolRegistry;
    private readonly toolExecutor;
    private readonly config;
    private readonly permissions;
    private readonly conversations?;
    private readonly merchantCart?;
    private readonly productIdentity?;
    private readonly websiteKnowledge?;
    private readonly logger;
    constructor(toolRegistry: ToolRegistryService, toolExecutor: ToolExecutorService, config: AgentRuntimeConfigService, permissions: ToolPermissionService, conversations?: ConversationsService | undefined, merchantCart?: MerchantCartService | undefined, productIdentity?: ProductIdentityService | undefined, websiteKnowledge?: WebsiteKnowledgeEngine | undefined);
    private isApplicationQuestion;
    private isUrgentSymptomQuestion;
    ask(question: string, context: AgentExecutionContext, options?: AgentTurnOptions): Promise<AgentResponse>;
    private traceFailure;
    private productCards;
    private parseToolArguments;
    private executeTool;
    private chatWithProvider;
    private chatWithOpenAICompatible;
    private chatWithOllama;
}
