export declare class AuthMailConfigError extends Error {
}
export declare class AuthMailer {
    private readonly transport?;
    private readonly from?;
    private readonly logger;
    constructor(env?: Record<string, string | undefined>);
    get available(): boolean;
    ensureAvailable(): void;
    verification(email: string, token: string): Promise<void>;
    passwordReset(email: string, token: string): void;
    passwordChanged(email: string): void;
    onModuleDestroy(): void;
    private send;
}
