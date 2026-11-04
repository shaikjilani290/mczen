export declare function parseCreateConversation(value: unknown): {
    assistantId: string;
    title: string | null;
    channel: "widget" | "voice" | "chat";
    language: "en" | "hi" | "te" | null;
    metadata: Record<string, string | number | boolean | string[]> | null;
};
export declare function parseUpdateConversation(value: unknown): {
    title?: string | null;
    language?: string | null;
    metadata?: Record<string, string | number | boolean | string[]> | null;
};
export declare function parseConversationQuery(value: unknown): {
    page: number;
    pageSize: number;
    status: "open" | "closed" | undefined;
    assistantId: string | undefined;
    q: string | undefined;
    sortBy: "lastMessageAt" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
};
export declare function parseTranscriptQuery(value: unknown): number;
export declare function parseAgentConversationId(value: unknown): string | undefined;
