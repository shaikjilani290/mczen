import { type AgentExecutionContext } from '../context/agent-execution-context.interface';
import { ToolRegistryService } from './tool-registry.service';
import { ToolPermissionService } from './tool-permission.service';
import { ToolValidationService } from './tool-validation.service';
import { ToolAuditService } from './tool-audit.service';
import { ToolExecutionResult } from './interfaces/tool-execution-result.interface';
export interface ToolExecutionOptions {
    readonly allowedToolNames?: ReadonlySet<string>;
}
export declare class ToolExecutorService {
    private readonly toolRegistry;
    private readonly permissions;
    private readonly validation;
    private readonly audit;
    constructor(toolRegistry: ToolRegistryService, permissions: ToolPermissionService, validation: ToolValidationService, audit: ToolAuditService);
    execute(toolName: unknown, input: unknown, context: AgentExecutionContext, signal?: AbortSignal, options?: ToolExecutionOptions): Promise<ToolExecutionResult>;
    private runHandler;
}
