import { type AgentExecutionContext } from './context/agent-execution-context.interface';
import { AgentRuntimeConfigService } from './config/agent-runtime-config.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { ToolPermissionService } from './tools/tool-permission.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ConversationsService } from '../conversations/conversations.service';
export interface AgentResponse {
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
}
export declare class AgentService {
    private readonly toolRegistry;
    private readonly toolExecutor;
    private readonly config;
    private readonly permissions;
    private readonly conversations?;
    private readonly logger;
    constructor(toolRegistry: ToolRegistryService, toolExecutor: ToolExecutorService, config: AgentRuntimeConfigService, permissions: ToolPermissionService, conversations?: ConversationsService | undefined);
    private isApplicationQuestion;
    private isUrgentSymptomQuestion;
    ask(question: string, context: AgentExecutionContext): Promise<AgentResponse>;
    private traceFailure;
    private parseToolArguments;
    private executeTool;
    private chatWithOllama;
}
