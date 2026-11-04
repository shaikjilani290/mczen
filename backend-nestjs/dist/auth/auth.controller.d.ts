import { AuthService } from './auth.service';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth-context';
export declare class AuthController {
    private readonly auth;
    constructor(auth: AuthService);
    register(body: unknown, request: AuthenticatedRequest): Promise<import("./auth.service").RegisterResult>;
    login(body: unknown): Promise<import("./auth.service").AuthResult>;
    refresh(body: unknown): Promise<import("./auth.service").GrantedTokens>;
    logout(user: AuthenticatedUser, body: unknown): Promise<{
        success: boolean;
    }>;
    me(user: AuthenticatedUser): Promise<import("./auth.service").MeResponse>;
    activate(user: AuthenticatedUser, tenantId: string, body: unknown): Promise<{
        accessToken: string;
        expiresIn: number;
        permissions: string[];
    }>;
    forgotPassword(body: unknown, request: AuthenticatedRequest): Promise<{
        resetToken?: string | undefined;
        success: boolean;
        message: string;
    }>;
    resetPassword(body: unknown): Promise<{
        success: boolean;
    }>;
    verifyEmail(body: unknown): Promise<{
        success: boolean;
    }>;
}
