import { AuthStore, type MemberTenantDto, type SessionRow, type UserRow } from './auth-store.service';
import { AuthMailer } from './auth.mailer';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { type LoginInput, type LogoutInput, type RegisterInput } from './auth.dto';
export interface GrantedTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
export interface UserDto {
    id: string;
    email: string;
    displayName: string | null;
    emailVerified: boolean;
}
export interface MeResponse {
    user: UserDto;
    activeTenantId: string | null;
    permissions: string[];
    tenants: MemberTenantDto[];
}
export interface AuthResult extends GrantedTokens {
    user: UserDto;
    activeTenantId: string | null;
    tenants: MemberTenantDto[];
}
export interface RegisterResult extends AuthResult {
    verificationToken?: string;
}
export declare class AuthService {
    private readonly store;
    private readonly passwords;
    private readonly tokens;
    private readonly mailer;
    constructor(store: AuthStore, passwords: PasswordService, tokens: TokenService, mailer: AuthMailer);
    register(input: RegisterInput, exposeDevToken?: boolean): Promise<RegisterResult>;
    login(dto: LoginInput): Promise<AuthResult>;
    private openSession;
    refresh(presented: unknown): Promise<GrantedTokens>;
    logout(userId: string, sessionId: string, dto: LogoutInput): Promise<void>;
    me(userId: string, sessionId: string): Promise<MeResponse>;
    activate(userId: string, sessionId: string, tenantId: string): Promise<{
        accessToken: string;
        expiresIn: number;
        permissions: string[];
    }>;
    requestPasswordReset(email: string | undefined, exposeDevToken?: boolean): Promise<string | undefined>;
    resetPassword(presented: unknown, newPassword: unknown): Promise<void>;
    verifyEmail(presented: unknown): Promise<void>;
    private pending;
    private insertPending;
}
export declare function live(user: UserRow | undefined, session: SessionRow | undefined): user is UserRow;
