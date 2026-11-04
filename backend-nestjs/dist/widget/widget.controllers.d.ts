import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth-context';
import { WidgetRepository } from './widget.repository';
import { WidgetService } from './widget.service';
export declare class WidgetAdminController {
    private readonly widget;
    constructor(widget: WidgetService);
    settings(): Promise<import("./widget.repository").WidgetSettingsView>;
    update(user: AuthenticatedUser, body: unknown): Promise<import("./widget.repository").WidgetSettingsView>;
    rotate(user: AuthenticatedUser): Promise<import("./widget.repository").WidgetSettingsView>;
    analytics(query: Record<string, unknown>): Promise<{
        range: {
            from: string;
            to: string;
        };
        totals: {
            conversations: number;
            messages: number;
            voiceConversations: number;
            textConversations: number;
            widgetConversations: number;
            knowledgeArticles: number;
            publishedKnowledgeArticles: number;
            activeVoiceSessions: number;
        };
        dailyConversations: {
            day: string;
            total: number;
        }[];
        messagesByModality: {
            modality: string;
            total: number;
        }[];
        languageDistribution: {
            language: string;
            total: number;
        }[];
        toolUsage: {
            tool: string;
            outcome: string;
            total: number;
        }[];
        assistantUsage: {
            assistantId: string;
            name: string;
            conversations: number;
        }[];
    }>;
}
export declare class WidgetPublicController {
    private readonly widget;
    constructor(widget: WidgetService);
    session(body: unknown, origin: string | undefined, request: Request): Promise<{
        sessionToken: string;
        expiresAt: string;
        config: {
            name: string;
            logoUrl: string | null;
            primaryColor: string;
            theme: "auto" | "light" | "dark";
            position: "bottom-right" | "bottom-left";
            buttonStyle: "round" | "pill" | "square";
            welcomeMessage: string | null;
            greeting: string | null;
            languages: string[];
            defaultLanguage: string;
            voice: import("../voice/widget-voice.service").WidgetVoiceAvailability;
        };
    }>;
    message(body: unknown, authorization: string | undefined, origin: string | undefined): Promise<{
        success: boolean;
        answer: string;
        sources: {
            id: string;
            title: string;
            source: string;
        }[];
        sessionToken: string;
        expiresAt: string;
    }>;
    voiceTicket(authorization: string | undefined, origin: string | undefined): Promise<{
        ticket: string;
        expiresInMs: number;
        conversationId: string;
        voice: import("../voice/widget-voice.service").WidgetVoiceAvailability;
        sessionToken: string;
        expiresAt: string;
    }>;
}
export declare class PlatformController {
    private readonly repository;
    constructor(repository: WidgetRepository);
    overview(): Promise<{
        tenants: number;
        activeTenants: number;
        assistants: number;
        conversations: number;
        enabledWidgets: number;
    }>;
    tenants(page?: string, pageSize?: string): Promise<{
        items: {
            id: string;
            name: string;
            slug: string;
            status: string;
            createdAt: unknown;
            assistants: number;
            conversations: number;
            widgetEnabled: boolean | null;
        }[];
        page: number;
        pageSize: number;
        total: number;
    }>;
    setStatus(user: AuthenticatedUser, id: string, body: unknown): Promise<{
        id: string;
        status: "active" | "suspended";
    }>;
}
