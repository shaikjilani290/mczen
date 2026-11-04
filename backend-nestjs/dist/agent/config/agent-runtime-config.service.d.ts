export interface AgentRuntimeConfig {
    readonly ollamaBaseUrl: string;
    readonly ollamaModel: string;
    readonly ollamaTimeoutMs: number;
    readonly maxRounds: number;
    readonly maxToolCalls: number;
}
export declare function readAgentRuntimeConfig(env: NodeJS.ProcessEnv): Readonly<AgentRuntimeConfig>;
export declare class AgentRuntimeConfigService {
    readonly values: Readonly<AgentRuntimeConfig>;
}
