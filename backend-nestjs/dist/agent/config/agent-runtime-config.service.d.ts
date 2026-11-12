export type LlmProvider = 'ollama' | 'openai-compatible';
export interface AgentRuntimeConfig {
    readonly responseMode: 'no-llm' | 'conversational';
    readonly llmProvider: LlmProvider;
    readonly llmBaseUrl: string;
    readonly llmModel: string;
    readonly ollamaBaseUrl: string;
    readonly ollamaModel: string;
    readonly ollamaTimeoutMs: number;
    readonly ollamaFallbackEnabled: boolean;
    readonly maxRounds: number;
    readonly maxToolCalls: number;
}
export declare function readAgentRuntimeConfig(env: NodeJS.ProcessEnv): Readonly<AgentRuntimeConfig>;
export declare class AgentRuntimeConfigService {
    readonly values: Readonly<AgentRuntimeConfig>;
}
