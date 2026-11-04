export interface WidgetSessionClaims {
    t: string;
    a: string;
    c?: string;
    s?: string;
    o: string;
    e: number;
    m: number;
}
export declare const WIDGET_SESSION_TTL_MS: number;
export declare const WIDGET_SESSION_MAX_MS: number;
export declare class WidgetSessionTokens {
    private readonly now;
    private readonly key;
    constructor(secret?: string | undefined, now?: () => number);
    issue(base: Omit<WidgetSessionClaims, 'e' | 'm'> & {
        m?: number;
    }): {
        token: string;
        claims: WidgetSessionClaims;
    };
    verify(token: unknown): WidgetSessionClaims | undefined;
    private sign;
}
