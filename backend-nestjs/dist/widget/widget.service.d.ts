import { AgentService } from '../agent/agent.service';
import { type WidgetSettingsUpdate, type WidgetLanguage } from './widget.dto';
import { WidgetRepository, type WidgetSettingsView } from './widget.repository';
import { type SharedState } from '../shared-state/shared-state';
import { WidgetVoiceService } from '../voice/widget-voice.service';
export declare const WIDGET_PERMISSIONS: readonly string[];
export declare class WidgetService {
    private readonly repository;
    private readonly agent;
    private readonly voice;
    private readonly logger;
    private readonly tokens;
    private readonly limiter;
    private readonly inFlight;
    constructor(repository: WidgetRepository, agent: AgentService, store: SharedState, voice: WidgetVoiceService);
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
    createSession(publicKey: string, origin: string | undefined, language: WidgetLanguage | undefined, peer: string | undefined): Promise<{
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
    voiceTicket(sessionToken: string | undefined, origin: string | undefined): Promise<{
        ticket: string;
        expiresInMs: number;
        conversationId: string;
        voice: import("../voice/widget-voice.service").WidgetVoiceAvailability;
        sessionToken: string;
        expiresAt: string;
    }>;
    ask(sessionToken: string | undefined, origin: string | undefined, message: string, language: WidgetLanguage | undefined): Promise<{
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
    private requireOrigin;
    private audit;
}
