export interface DemoProduct {
    id: string;
    name: string;
    category: string;
    price: number;
    summary: string;
    stock: number;
}
export declare const DEMO_PRODUCT_CATALOGUES: Readonly<Record<string, readonly DemoProduct[]>>;
export declare function getDemoCategories(tenantId: string): readonly string[];
