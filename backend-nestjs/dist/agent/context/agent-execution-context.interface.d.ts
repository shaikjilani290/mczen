export interface AgentExecutionContext {
    tenantId: string;
    userId?: string;
    conversationId?: string;
    modality?: 'text' | 'voice';
    channel?: 'widget';
    language?: 'en' | 'hi' | 'te';
    assistantId?: string;
    permissions: readonly string[];
    requestId: string;
}
export declare function isAgentExecutionContext(value: unknown): value is AgentExecutionContext;
