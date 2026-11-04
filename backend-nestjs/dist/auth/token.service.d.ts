export declare const JWT_ISSUER = "mczen-ai";
export declare const JWT_AUDIENCE = "mczen-dashboard";
export interface AccessTokenPayload {
    userId: string;
    sessionId: string;
    tenantId: string | null;
}
export interface VerifiedToken extends AccessTokenPayload {
    iat: number;
    exp: number;
}
export type TokenVerifyError = 'malformed' | 'bad_algorithm' | 'unknown_kid' | 'bad_signature' | 'expired' | 'not_yet_valid' | 'bad_issuer' | 'bad_audience' | 'bad_claims';
export declare class TokenConfigError extends Error {
}
type TokenEnv = Record<string, string | undefined>;
export interface TokenServiceOptions {
    env?: TokenEnv;
}
export declare class TokenService {
    private readonly keys;
    private readonly currentKid;
    private readonly accessTtlMs;
    private readonly refreshTtlSec;
    private readonly nowSource;
    constructor(options?: TokenServiceOptions);
    get accessTtlSeconds(): number;
    get refreshTtlSeconds(): number;
    sign(payload: AccessTokenPayload, now?: number): string;
    verify(token: string, now?: number): {
        ok: true;
        claims: VerifiedToken;
    } | {
        ok: false;
        reason: TokenVerifyError;
    };
    private hmac;
}
export declare function newRefreshToken(): string;
export declare function hashOpaqueToken(presented: string): string;
export declare function newPendingToken(): string;
export declare function isOpaqueToken(value: unknown, prefix: 'mzr_' | 'mzp_'): value is string;
export {};
