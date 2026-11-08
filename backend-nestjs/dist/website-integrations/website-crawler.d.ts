export interface CrawledPage {
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
    lastUpdatedAt: Date | null;
}
export declare class WebsiteCrawler {
    crawl(origin: string, onDiscovered?: (count: number) => Promise<void>): Promise<{
        pages: CrawledPage[];
        errors: string[];
    }>;
    private readRobots;
    private safePageUrl;
    private fetchText;
    private resolvePublic;
    private requestOnce;
}
