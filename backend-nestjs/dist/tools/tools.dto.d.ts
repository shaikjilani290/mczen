export interface TenantToolUpdate {
    enabled?: boolean;
    extraPermissions?: string[];
    config?: Record<string, unknown>;
}
export declare function parseTenantToolUpdate(value: unknown): TenantToolUpdate;
export declare function parseAssistantToolUpdate(value: unknown): boolean;
export declare function parseToolSecret(value: unknown): {
    value: string;
    expiresAt: string | null;
};
export declare function validateToolReference(value: string): string;
