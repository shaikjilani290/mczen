import { AgentExecutionContext } from './agent-execution-context.interface';
export declare const DEV_TENANT_HEADER = "x-mczen-tenant-id";
export type RequestHeaders = Record<string, string | string[] | undefined>;
export declare class TenantContextService {
    resolve(): AgentExecutionContext;
    resolveDevelopment(headers: RequestHeaders, remoteAddress?: string, requestId?: `${string}-${string}-${string}-${string}-${string}`): AgentExecutionContext;
    private isProduction;
}
