import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth-context';
import { WidgetService } from '../widget/widget.service';
import { WebsiteIntegrationService } from './website-integration.service';
export declare class WebsiteIntegrationAdminController {
    private readonly service;
    constructor(service: WebsiteIntegrationService);
    list(): Promise<{
        [x: string]: unknown;
    }[]>;
    create(user: AuthenticatedUser, body: unknown): Promise<{
        integration: {
            [x: string]: unknown;
        };
        ingestionKey: string;
    }>;
    status(id: string): Promise<{
        [x: string]: unknown;
    }>;
    pages(id: string, query: Record<string, unknown>): Promise<{
        [x: string]: unknown;
    }[]>;
    products(id: string, query: Record<string, unknown>): Promise<{
        [x: string]: unknown;
    }[]>;
    knowledge(id: string, query: Record<string, unknown>): Promise<{
        [x: string]: unknown;
    }[]>;
    sync(id: string): Promise<{
        id: string;
        syncStatus: "running";
    }>;
    rebuildIndex(id: string): Promise<{
        id: string;
        status: "completed";
        indexed: number;
    }>;
    rotateKeys(id: string): Promise<{
        publicKey: string;
        ingestionKey: string;
    }>;
    revoke(id: string): Promise<{
        id: string;
        status: "revoked";
    }>;
}
export declare class WebsiteIntegrationPublicController {
    private readonly widget;
    constructor(widget: WidgetService);
    connect(body: unknown, origin: string | undefined, request: Request): Promise<{
        sessionToken: string;
        expiresAt: string;
        config: {
            name: string;
            logoUrl: null;
            primaryColor: string;
            theme: string;
            position: string;
            buttonStyle: string;
            welcomeMessage: null;
            greeting: string | null;
            languages: string[];
            defaultLanguage: string;
            voice: import("../voice/widget-voice.service").WidgetVoiceAvailability;
        };
    } | {
        sessionToken: string;
        expiresAt: string;
        config: {
            name: string;
            logoUrl: string | null;
            primaryColor: string;
            theme: "light" | "dark" | "auto";
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
        sessionToken: string;
        expiresAt: string;
        products?: import("../agent/agent.service").AgentProductCard[] | undefined;
        success: boolean;
        answer: string;
        sources: {
            id: string;
            title: string;
            source: string;
        }[];
    }>;
    voiceTicket(authorization: string | undefined, origin: string | undefined): Promise<{
        ticket: string;
        expiresInMs: number;
        conversationId: string;
        voice: import("../voice/widget-voice.service").WidgetVoiceAvailability;
        sessionToken: string;
        expiresAt: string;
    }>;
    cartPoll(body: unknown, authorization: string | undefined, origin: string | undefined): Promise<{
        acknowledged: boolean;
    } | {
        action: import("./merchant-cart.service").CartAction | null;
    }>;
    productContext(body: unknown, authorization: string | undefined, origin: string | undefined): Promise<{
        accepted: boolean;
        sections: number;
    }>;
    cartResult(body: unknown, authorization: string | undefined, origin: string | undefined): Promise<{
        acknowledged: boolean;
    } | {
        action: import("./merchant-cart.service").CartAction | null;
    }>;
}
export declare class WebsiteIngestionController {
    private readonly service;
    private readonly widget;
    constructor(service: WebsiteIntegrationService, widget: WidgetService);
    ingestPages(authorization: string | undefined, body: unknown): Promise<{
        accepted: number;
        indexed: number;
    }>;
    ingestProducts(authorization: string | undefined, body: unknown): Promise<{
        accepted: number;
    }>;
    ingestBatch(authorization: string | undefined, body: unknown): Promise<{
        accepted: {
            pages: number;
            products: number;
        };
        indexed: number;
    }>;
    trackPageView(authorization: string | undefined, origin: string | undefined, body: unknown): Promise<{
        tracked: boolean;
    }>;
}
