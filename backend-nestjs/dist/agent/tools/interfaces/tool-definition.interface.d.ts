import { AgentExecutionContext } from '../../context/agent-execution-context.interface';
export type ToolCategory = 'knowledge' | 'products' | 'orders' | 'customers' | 'payments' | 'communication' | 'school' | 'matrimonial' | 'custom';
export type ToolTenantMode = 'ALL_TENANTS' | 'RESTRICTED';
export interface ToolInputProperty {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    enum?: readonly string[];
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    items?: ToolInputProperty;
    properties?: Record<string, ToolInputProperty>;
}
export interface ToolInputSchema {
    type: 'object';
    required: string[];
    properties: Record<string, ToolInputProperty>;
    additionalProperties: false;
}
export type ToolHandler = (input: Record<string, unknown>, context: AgentExecutionContext, signal: AbortSignal, runtime?: ToolRuntimeConfiguration) => Promise<unknown>;
export interface ToolRuntimeConfiguration {
    readonly config: Readonly<Record<string, unknown>>;
    readonly secrets: Readonly<Record<string, string>>;
}
export interface ToolDefinition {
    name: string;
    description: string;
    category: ToolCategory;
    requiredPermissions: readonly string[];
    enabled: boolean;
    requiresConfirmation: boolean;
    timeoutMs: number;
    tenantMode: ToolTenantMode;
    allowedTenants?: readonly string[];
    inputSchema: ToolInputSchema;
    configurationSchema?: ToolInputSchema;
    handler: ToolHandler;
}
export interface ToolMetadata {
    name: string;
    description: string;
    category: ToolCategory;
    requiredPermissions: readonly string[];
    enabled: boolean;
    requiresConfirmation: boolean;
    inputSchema: ToolInputSchema;
}
