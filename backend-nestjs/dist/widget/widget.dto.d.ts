export declare const WIDGET_LANGUAGES: readonly ["en", "hi", "te"];
export type WidgetLanguage = (typeof WIDGET_LANGUAGES)[number];
export declare const WIDGET_THEMES: readonly ["light", "dark", "auto"];
export declare const WIDGET_POSITIONS: readonly ["bottom-right", "bottom-left"];
export declare const WIDGET_BUTTON_STYLES: readonly ["round", "pill", "square"];
export interface WidgetSettingsUpdate {
    enabled?: boolean;
    assistantId?: string | null;
    name?: string;
    logoUrl?: string | null;
    primaryColor?: string;
    theme?: (typeof WIDGET_THEMES)[number];
    position?: (typeof WIDGET_POSITIONS)[number];
    buttonStyle?: (typeof WIDGET_BUTTON_STYLES)[number];
    welcomeMessage?: string | null;
    initialGreeting?: string | null;
    allowedOrigins?: string[];
}
export declare function normalizeOrigin(value: unknown, production?: boolean): string;
export declare function parseWidgetSettingsUpdate(body: unknown): WidgetSettingsUpdate;
export declare function isPublicKey(value: unknown): value is string;
export declare function parsePublicSession(body: unknown): {
    publicKey: string;
    language?: WidgetLanguage;
};
export declare function parsePublicMessage(body: unknown): {
    message: string;
    language?: WidgetLanguage;
};
export interface DateRange {
    from: Date;
    to: Date;
}
export declare function parseDateRange(query: Record<string, unknown>, now?: Date): DateRange;
export declare function parseTenantStatus(body: unknown): {
    status: 'active' | 'suspended';
    reason: string | null;
};
