import { type WidgetLanguage } from '../widget/widget.dto';
export declare function isLocalWebsiteOrigin(origin: string): boolean;
export declare function assertWebsiteIngestionOrigin(origin: string): void;
export interface CreateWebsiteIntegrationInput {
    name: string;
    origin: string;
    assistantId: string;
}
export interface WebsitePageInput {
    url: string;
    title: string;
    metaDescription: string | null;
    mainContent: string;
    headings: string[];
    links: Array<{
        url: string;
        text: string;
    }>;
    pageType: string;
    language: WidgetLanguage;
    lastUpdatedAt: Date | null;
    status: 'active' | 'inactive';
}
export interface WebsiteProductInput {
    externalProductId: string;
    name: string;
    description: string | null;
    sku: string | null;
    brand: string | null;
    category: string | null;
    price: number | null;
    salePrice: number | null;
    currency: string | null;
    stock: number | null;
    availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued' | 'unknown';
    images: string[];
    productUrl: string;
    attributes: Record<string, unknown>;
    updatedAt: Date | null;
    status: 'active' | 'inactive';
}
export declare function parseCreateWebsiteIntegration(body: unknown): CreateWebsiteIntegrationInput;
export declare function parseWebsitePage(value: unknown, origin: string): WebsitePageInput;
export declare function parseWebsiteProduct(value: unknown, origin: string): WebsiteProductInput;
export declare function parseWebsiteBatch(body: unknown, origin: string): {
    pages: WebsitePageInput[];
    products: WebsiteProductInput[];
};
export declare function parseSiteConnect(body: unknown): {
    publicKey: string;
    assistantId?: string;
    language?: WidgetLanguage;
};
export declare function parsePageView(body: unknown): {
    pageUrl: string;
    title: string | null;
    referrer: string | null;
};
