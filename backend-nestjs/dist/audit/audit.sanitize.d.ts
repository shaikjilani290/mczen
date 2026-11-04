export type AuditMetadata = Record<string, string | number | boolean | null>;
export declare function sanitizeMetadata(input: unknown): AuditMetadata | null;
