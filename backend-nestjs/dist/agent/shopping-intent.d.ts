export type ShoppingIntent = 'PRODUCT_SEARCH' | 'PRODUCT_DETAILS' | 'PRODUCT_COMPARISON' | 'ADD_TO_CART' | 'REMOVE_FROM_CART' | 'UPDATE_CART_QUANTITY' | 'VIEW_CART' | 'CHECKOUT' | 'PRODUCT_FOLLOW_UP' | 'GENERAL_CONVERSATION';
export declare function shoppingIntent(question: string): ShoppingIntent;
export declare function productQuery(question: string): string;
