type InternalMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{
        id?: string;
        function: {
            name: string;
            arguments: unknown;
        };
    }>;
    tool_name?: string;
    tool_call_id?: string;
};
type CompatibleAssistantMessage = {
    content: string;
    toolCalls: unknown[];
};
export declare function toCompatibleMessages(messages: InternalMessage[]): Record<string, unknown>[];
export declare function parseCompatibleResponse(value: unknown): CompatibleAssistantMessage;
export {};
