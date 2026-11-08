import type { AuthenticatedUser } from '../auth/auth-context';
import { ConversationsService } from './conversations.service';
export declare class ConversationsController {
    private readonly conversations;
    constructor(conversations: ConversationsService);
    create(body: unknown, user: AuthenticatedUser): Promise<{
        id: string;
    }>;
    list(query: unknown, user: AuthenticatedUser): Promise<{
        items: {
            id: string;
            assistantId: string;
            userId: string | null;
            channel: unknown;
            language: unknown;
            status: unknown;
            title: unknown;
            metadata: unknown;
            messageCount: number;
            lastMessageAt: unknown;
            createdAt: unknown;
            updatedAt: unknown;
        }[];
        page: number;
        pageSize: number;
        total: number;
    }>;
    get(id: string, user: AuthenticatedUser): Promise<{
        messages: {
            id: string;
            role: unknown;
            content: unknown;
            status: unknown;
            language: unknown;
            modality: unknown;
            model: unknown;
            sources: unknown;
            toolCallsCount: number;
            errorCode: unknown;
            createdAt: unknown;
        }[];
        id: string;
        assistantId: string;
        userId: string | null;
        channel: unknown;
        language: unknown;
        status: unknown;
        title: unknown;
        metadata: unknown;
        messageCount: number;
        lastMessageAt: unknown;
        createdAt: unknown;
        updatedAt: unknown;
        closedAt: unknown;
    }>;
    update(id: string, body: unknown, user: AuthenticatedUser): Promise<{
        id: string;
        assistantId: string;
        userId: string | null;
        channel: unknown;
        language: unknown;
        status: unknown;
        title: unknown;
        metadata: unknown;
        messageCount: number;
        lastMessageAt: unknown;
        createdAt: unknown;
        updatedAt: unknown;
        closedAt: unknown;
    }>;
    archive(id: string, user: AuthenticatedUser): Promise<{
        success: boolean;
    }>;
    transcript(id: string, query: unknown, user: AuthenticatedUser): Promise<{
        id: string;
        role: unknown;
        content: unknown;
        status: unknown;
        language: unknown;
        modality: unknown;
        model: unknown;
        sources: unknown;
        toolCallsCount: number;
        errorCode: unknown;
        createdAt: unknown;
    }[]>;
    toolCalls(id: string, messageId: string, user: AuthenticatedUser): Promise<{
        [x: string]: unknown;
    }[]>;
}
