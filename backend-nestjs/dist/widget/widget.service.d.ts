import { AgentService } from '../agent/agent.service';
import { type WidgetSettingsUpdate, type WidgetLanguage } from './widget.dto';
import { WidgetRepository, type WidgetSettingsView } from './widget.repository';
import { type SharedState } from '../shared-state/shared-state';
import { WidgetVoiceService } from '../voice/widget-voice.service';
import { WebsiteIntegrationRepository } from '../website-integrations/website-integration.repository';
import { MerchantCartService } from '../website-integrations/merchant-cart.service';
export declare const WIDGET_PERMISSIONS: readonly string[];
export declare class WidgetService {
    private readonly repository;
    private readonly agent;
    private readonly voice;
    private readonly websiteIntegrations?;
    private readonly merchantCart?;
    private readonly logger;
    private readonly tokens;
    private readonly limiter;
    private readonly inFlight;
    constructor(repository: WidgetRepository, agent: AgentService, store: SharedState, voice: WidgetVoiceService, websiteIntegrations?: WebsiteIntegrationRepository | undefined, merchantCart?: MerchantCartService | undefined);
    private tenant;
    getSettings(): Promise<WidgetSettingsView>;
    updateSettings(input: WidgetSettingsUpdate, userId: string): Promise<WidgetSettingsView>;
    rotateKey(userId: string): Promise<WidgetSettingsView>;
    analytics(range: Parameters<WidgetRepository['analytics']>[1]): Promise<{
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
    createSession(publicKey: string, origin: string | undefined, language: WidgetLanguage | undefined, peer: string | undefined, assistantId?: string): Promise<{
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
    voiceTicket(sessionToken: string | undefined, origin: string | undefined): Promise<{
        ticket: string;
        expiresInMs: number;
        conversationId: string;
        voice: import("../voice/widget-voice.service").WidgetVoiceAvailability;
        sessionToken: string;
        expiresAt: string;
    }>;
    ask(sessionToken: string | undefined, origin: string | undefined, message: string, language: WidgetLanguage | undefined, requestId?: string): Promise<{
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
    private createWebsiteSession;
    private requireWebsiteSession;
    productContext(sessionToken: string | undefined, origin: string | undefined, body: unknown): Promise<{
        accepted: boolean;
        sections: number;
    }>;
    trackWebsitePage(sessionToken: string | undefined, origin: string | undefined, body: unknown): Promise<{
        tracked: boolean;
    }>;
    cartBridge(sessionToken: string | undefined, origin: string | undefined, body: unknown, complete?: boolean): Promise<{
        acknowledged: boolean;
    } | {
        action: import("../website-integrations/merchant-cart.service").CartAction | null;
    }>;
    private requireOrigin;
    private audit;
}
