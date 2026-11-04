import type { AuthenticatedUser } from '../auth/auth-context';
import { ToolsService } from './tools.service';
export declare class ToolsController {
    private readonly tools;
    constructor(tools: ToolsService);
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
    secretStatus(name: string): Promise<{
        configured: boolean;
        lastRotatedAt: Date | null;
        expiresAt: Date | null;
    }>;
    setSecret(user: AuthenticatedUser, name: string, body: unknown): Promise<{
        configured: boolean;
        lastRotatedAt: Date | null;
        expiresAt: Date | null;
    }>;
    clearSecret(name: string): Promise<{
        configured: boolean;
        lastRotatedAt: Date | null;
        expiresAt: Date | null;
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
    update(user: AuthenticatedUser, name: string, body: unknown): Promise<{
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
    updateAssistant(name: string, assistantId: string, body: unknown): Promise<{
        name: string;
        assistantId: string;
        enabled: boolean;
    }>;
}
