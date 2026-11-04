export interface RegisterInput {
    email: string;
    password: string;
    name?: string;
    tenantName?: string;
    tenantSlug?: string;
    inviteToken?: string;
}
export interface LoginInput {
    email: string;
    password: string;
}
export interface LogoutInput {
    refreshToken?: string;
    allSessions?: boolean;
}
export declare function bodyObject(body: unknown, allowed: readonly string[]): Record<string, unknown>;
export declare function normalizeEmail(value: unknown): string | undefined;
export declare function validatePassword(value: unknown): asserts value is string;
export declare function parseRegisterInput(body: unknown): RegisterInput;
export declare function parseLoginInput(body: unknown): LoginInput;
export declare function parseLogoutInput(body: unknown): LogoutInput;
