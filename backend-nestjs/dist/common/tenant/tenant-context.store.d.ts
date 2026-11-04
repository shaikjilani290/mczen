import { AsyncLocalStorage } from 'node:async_hooks';
export type TenantActorType = 'user' | 'api_key' | 'widget' | 'system';
export interface TenantContext {
    readonly tenantId: string;
    readonly actorType: TenantActorType;
    readonly userId?: string;
    readonly assistantId?: string;
    readonly permissions: readonly string[];
    readonly requestId?: string;
}
export declare class TenantContextMissingError extends Error {
    constructor(message?: string);
}
export declare class TenantContextStore {
    readonly als: AsyncLocalStorage<TenantContext>;
    run<T>(context: TenantContext, fn: () => T): T;
    get(): TenantContext | undefined;
    getOrThrow(): TenantContext;
    isActive(): boolean;
}
export declare const tenantContextStore: TenantContextStore;
