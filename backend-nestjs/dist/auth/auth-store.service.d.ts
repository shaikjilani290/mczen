import { DataSource } from 'typeorm';
export type AuthDb = Pick<DataSource, 'query'>;
export interface UserRow {
    id: string;
    email: string;
    passwordHash: string;
    status: 'active' | 'disabled' | 'erased';
    emailVerifiedAt: Date | null;
    failedLoginCount: number;
    lockedUntil: Date | null;
    displayName: string | null;
    tokenVersion: number;
    loginFailureWindowStartedAt: Date | null;
}
export interface MemberTenantDto {
    id: string;
    name: string;
    slug: string;
    tenantStatus: 'active' | 'suspended' | 'closed';
    role: string;
}
export interface SessionRow {
    id: string;
    userId: string;
    activeTenantId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
    tokenVersion: number;
}
export interface MembershipRow {
    status: string;
    roleId: number;
    roleKey: string;
    roleIsPlatform: boolean;
}
export declare class AuthStore {
    private readonly source?;
    constructor(source?: DataSource | undefined);
    get database(): DataSource;
    findUserByEmail(email: string): Promise<UserRow | undefined>;
    findUserById(id: string, db?: AuthDb, lock?: boolean): Promise<UserRow | undefined>;
    findSession(id: string, db?: AuthDb, lock?: boolean): Promise<SessionRow | undefined>;
    findTenant(id: string, db?: AuthDb): Promise<{
        id: string;
        status: string;
    } | undefined>;
    findMembership(userId: string, tenantId: string, db?: AuthDb): Promise<MembershipRow | undefined>;
    listActiveMemberships(userId: string, db?: AuthDb): Promise<MemberTenantDto[]>;
    rolePermissions(roleId: number, db?: AuthDb): Promise<string[]>;
    touchSession(userId: string, sessionId: string): Promise<void>;
    platformRole(userId: string): Promise<number | undefined>;
}
