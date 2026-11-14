import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { type SharedState } from '../shared-state/shared-state';
import { WebsiteIntegrationRepository } from './website-integration.repository';
export interface MerchantBinding {
    integrationId: string;
    sessionId: string;
    origin: string;
}
export interface MerchantCartItem {
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    currency: string;
    variantId?: string;
}
export interface MerchantCartSnapshot {
    items: MerchantCartItem[];
    itemCount: number;
    total: number;
    currency: string;
    cartPath: '/cart';
}
type Operation = 'add_to_cart' | 'get_cart' | 'update_cart_item' | 'remove_cart_item' | 'open_cart';
export interface CartAction {
    id: string;
    operation: Operation;
    productId?: string;
    variantId?: string;
    quantity?: number;
    expectedQuantity?: number;
}
export interface MerchantNavigationAction {
    id: string;
    type: 'OPEN_CHECKOUT' | 'OPEN_CART';
    url: string;
    merchantOrigin: string;
}
export interface VerifiedCartOperation {
    operation: Operation;
    productId?: string;
    productName?: string;
    quantity?: number;
    cartVerified: true;
    cartUrl: string;
    checkoutUrl?: string;
    navigationAction?: MerchantNavigationAction;
}
export interface ShoppingContext {
    currentProductId?: string;
    previousProductId?: string;
    currentProductName?: string;
    lastIntent?: string;
    lastCartAction?: string;
    pendingClarification?: string;
}
export declare class MerchantCartService {
    private readonly store;
    private readonly products;
    private readonly navigation;
    constructor(store: SharedState, products: WebsiteIntegrationRepository);
    private readNavigation;
    private navigationUrls;
    private scope;
    poll(tenant: string, binding: MerchantBinding, body: unknown): Promise<{
        action: CartAction | null;
    }>;
    remember(context: AgentExecutionContext, ids: string[], select?: boolean): Promise<void>;
    shoppingContext(context: AgentExecutionContext): Promise<ShoppingContext>;
    updateShoppingContext(context: AgentExecutionContext, update: ShoppingContext): Promise<void>;
    selected(context: AgentExecutionContext, ordinal?: number, pageReference?: boolean): Promise<string | undefined>;
    rememberProductContext(tenant: string, binding: MerchantBinding, assistantId: string, body: unknown): Promise<{
        accepted: boolean;
        sections: number;
    }>;
    productContext(context: AgentExecutionContext, productId: string): Promise<unknown>;
    complete(tenant: string, binding: MerchantBinding, body: unknown): Promise<{
        acknowledged: boolean;
    }>;
    execute(operation: Operation, input: Record<string, unknown>, context: AgentExecutionContext, signal: AbortSignal, deadline?: number): Promise<{
        success: boolean;
        cart?: MerchantCartSnapshot;
        error?: string;
    } & Partial<VerifiedCartOperation>>;
    private validateSnapshot;
}
export {};
