import { DataSource, ObjectLiteral } from 'typeorm';
import { TenantScopedRepository } from '../common/tenant/tenant-scoped.repository';
import type { ToolDefinition } from '../agent/tools/interfaces/tool-definition.interface';
import { ToolSecretCipher } from './tool-secret-cipher';
type Row = Record<string, unknown>;
export interface ToolExecutionSettings {
    available: boolean;
    enabled: boolean;
    requiredPermissions: string[];
    config: Record<string, unknown>;
    secrets: Record<string, string>;
    timeoutMs: number;
    requiresConfirmation: boolean;
}
export declare class ToolConfigurationRepository extends TenantScopedRepository<ObjectLiteral> {
    private readonly source?;
    private readonly secretCipher?;
    constructor(source?: DataSource | undefined, secretCipher?: ToolSecretCipher | undefined);
    get configured(): boolean;
    private get database();
    private tenant;
    private run;
    syncCatalog(definitions: readonly ToolDefinition[]): Promise<void>;
    listTenantTools(definitions: readonly ToolDefinition[], assistantId?: string): Promise<Row[]>;
    executionSettings(name: string, definition: ToolDefinition, assistantId?: string): Promise<ToolExecutionSettings>;
    executionSecrets(name: string): Promise<Record<string, string>>;
    detail(name: string): Promise<Row>;
    updateTenant(name: string, actorId: string, update: {
        enabled?: boolean;
        extraPermissions?: string[];
        config?: Record<string, unknown>;
    }): Promise<void>;
    setAssistantTool(name: string, assistantId: string, enabled: boolean): Promise<void>;
    secretStatus(name: string): Promise<{
        configured: boolean;
        lastRotatedAt: Date | null;
        expiresAt: Date | null;
    }>;
    setSecret(name: string, actorId: string, secret: string, expiresAt: string | null): Promise<void>;
    revokeSecret(name: string): Promise<void>;
    nameById(id: string): Promise<string>;
    private toolId;
}
export declare function secretAad(tenantId: string, toolName: string, label: string, version: number): string;
export {};
