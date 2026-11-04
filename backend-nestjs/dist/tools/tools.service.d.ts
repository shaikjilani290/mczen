import type { AuthenticatedUser } from '../auth/auth-context';
import { ToolRegistryService } from '../agent/tools/tool-registry.service';
import { ToolValidationService } from '../agent/tools/tool-validation.service';
import { ToolConfigurationRepository } from './tool-configuration.repository';
import { ToolSecretCipher } from './tool-secret-cipher';
import type { TenantToolUpdate } from './tools.dto';
export declare class ToolsService {
    private readonly registry;
    private readonly repository;
    private readonly validation;
    private readonly cipher;
    constructor(registry: ToolRegistryService, repository: ToolConfigurationRepository, validation: ToolValidationService, cipher: ToolSecretCipher);
    list(): Promise<{
        items: {
            id: string;
            name: string;
            displayName: string;
            description: string;
            category: import("../agent/tools/interfaces/tool-definition.interface").ToolCategory;
            enabled: boolean;
            requiresConfirmation: boolean;
            requiredPermissions: string[];
            configConfigured: boolean;
            secret: {
                configured: boolean;
                lastRotatedAt: {} | null;
            };
        }[];
    }>;
    get(name: string): Promise<{
        id: string;
        name: string;
        displayName: string;
        description: string;
        category: import("../agent/tools/interfaces/tool-definition.interface").ToolCategory;
        enabled: boolean;
        requiredPermissions: string[];
        inputSchema: import("../agent/tools/interfaces/tool-definition.interface").ToolInputSchema;
        configurationSchema: {
            type: "object";
            required: string[];
            properties: {};
            additionalProperties: false;
        };
        tenantConfig: Record<string, unknown>;
        extraPermissions: string[];
        secret: {
            configured: boolean;
            lastRotatedAt: {} | null;
            expiresAt: {} | null;
        };
    }>;
    update(name: string, input: TenantToolUpdate, user: AuthenticatedUser): Promise<{
        id: string;
        name: string;
        displayName: string;
        description: string;
        category: import("../agent/tools/interfaces/tool-definition.interface").ToolCategory;
        enabled: boolean;
        requiredPermissions: string[];
        inputSchema: import("../agent/tools/interfaces/tool-definition.interface").ToolInputSchema;
        configurationSchema: {
            type: "object";
            required: string[];
            properties: {};
            additionalProperties: false;
        };
        tenantConfig: Record<string, unknown>;
        extraPermissions: string[];
        secret: {
            configured: boolean;
            lastRotatedAt: {} | null;
            expiresAt: {} | null;
        };
    }>;
    updateAssistant(name: string, assistantId: string, enabled: boolean): Promise<{
        name: string;
        assistantId: string;
        enabled: boolean;
    }>;
    secretStatus(name: string): Promise<{
        configured: boolean;
        lastRotatedAt: Date | null;
        expiresAt: Date | null;
    }>;
    setSecret(name: string, value: string, expiresAt: string | null, user: AuthenticatedUser): Promise<{
        configured: boolean;
        lastRotatedAt: Date | null;
        expiresAt: Date | null;
    }>;
    clearSecret(name: string): Promise<{
        configured: boolean;
        lastRotatedAt: Date | null;
        expiresAt: Date | null;
    }>;
    private resolve;
}
