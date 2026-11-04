import { OnModuleInit } from '@nestjs/common';
import { KnowledgeService } from '../knowledge.service';
import { ToolConfigurationRepository, ToolExecutionSettings } from '../../tools/tool-configuration.repository';
import { ToolDefinition, ToolMetadata } from './interfaces/tool-definition.interface';
export declare class ToolRegistryService implements OnModuleInit {
    private readonly knowledge;
    private readonly configuration?;
    private readonly tools;
    constructor(knowledge: KnowledgeService, configuration?: ToolConfigurationRepository | undefined);
    onModuleInit(): Promise<void>;
    register(tool: ToolDefinition): void;
    unregister(name: string): boolean;
    getTool(name: string): ToolDefinition | undefined;
    listDefinitions(): ToolDefinition[];
    hasTool(name: string): boolean;
    isToolEnabled(name: string): boolean;
    isToolAvailableToTenant(name: string, tenantId: string): boolean;
    listTools(): ToolMetadata[];
    listForTenant(tenantId: string): ToolMetadata[];
    listForTenantAtCallTime(tenantId: string, assistantId?: string): Promise<ToolMetadata[]>;
    executionSettings(name: string, tenantId: string, definition: ToolDefinition, assistantId?: string): Promise<ToolExecutionSettings>;
    executionSecrets(name: string, tenantId: string): Promise<Record<string, string>>;
}
