import { DataSource } from 'typeorm';
import type { DateRange, WidgetSettingsUpdate } from './widget.dto';
export interface WidgetSettingsView {
    publicKey: string;
    enabled: boolean;
    assistantId: string | null;
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    theme: 'light' | 'dark' | 'auto';
    position: 'bottom-right' | 'bottom-left';
    buttonStyle: 'round' | 'pill' | 'square';
    welcomeMessage: string | null;
    initialGreeting: string | null;
    allowedOrigins: string[];
    keyRotatedAt: string | null;
    updatedAt: string;
}
export interface PublicWidgetTarget {
    tenantId: string;
    settings: WidgetSettingsView;
}
export interface WidgetAssistant {
    id: string;
    name: string;
    greeting: string | null;
    languages: string[];
    defaultLanguage: string;
}
export declare function newPublicKey(): string;
export declare class WidgetRepository {
    private readonly source;
    constructor(source: DataSource);
    private query;
    getOrCreate(tenantId: string): Promise<WidgetSettingsView>;
    update(tenantId: string, input: WidgetSettingsUpdate, userId: string): Promise<WidgetSettingsView>;
    rotateKey(tenantId: string, userId: string): Promise<WidgetSettingsView>;
    findByPublicKey(publicKey: string): Promise<PublicWidgetTarget | undefined>;
    findForTenant(tenantId: string): Promise<PublicWidgetTarget | undefined>;
    resolveAssistant(tenantId: string, preferred: string | null): Promise<WidgetAssistant | undefined>;
    createWidgetConversation(tenantId: string, assistantId: string, language: string): Promise<string>;
    analytics(tenantId: string, range: DateRange): Promise<{
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
    platformTenants(page: number, pageSize: number): Promise<{
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
    platformOverview(): Promise<{
        tenants: number;
        activeTenants: number;
        assistants: number;
        conversations: number;
        enabledWidgets: number;
    }>;
    setTenantStatus(tenantId: string, status: 'active' | 'suspended', reason: string | null): Promise<boolean>;
}
