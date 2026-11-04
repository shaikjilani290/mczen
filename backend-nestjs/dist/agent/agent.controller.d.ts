import type { Response } from 'express';
import { TenantContextService } from './context/tenant-context.service';
import { AgentService } from './agent.service';
import { ToolRegistryService } from './tools/tool-registry.service';
export declare class AgentController {
    private readonly agent;
    private readonly toolRegistry;
    private readonly tenantContext;
    constructor(agent: AgentService, toolRegistry: ToolRegistryService, tenantContext: TenantContextService);
    ask(body: unknown, response?: Response): Promise<import("./agent.service").AgentResponse>;
    getTools(response?: Response): Promise<{
        success: boolean;
        tools: import("./tools/interfaces/tool-definition.interface").ToolMetadata[];
    }>;
}
