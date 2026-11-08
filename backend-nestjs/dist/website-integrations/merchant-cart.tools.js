"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMerchantCartTools = createMerchantCartTools;
function createMerchantCartTools(cart) {
    return ['add_to_cart', 'get_cart', 'update_cart_item', 'remove_cart_item', 'open_cart'].map(name => {
        const product = ['add_to_cart', 'update_cart_item', 'remove_cart_item'].includes(name);
        const quantity = ['add_to_cart', 'update_cart_item'].includes(name);
        const optionalQuantity = name === 'remove_cart_item';
        return {
            name, category: 'products', requiredPermissions: ['products:read'], enabled: true,
            requiresConfirmation: false, tenantMode: 'ALL_TENANTS', timeoutMs: 18_000,
            description: `${name}: operate only the current verified visitor's merchant-owned guest cart. Success requires merchant read-back. Never claim checkout/payment. Use an actual imported productId; do not invent variants. Repeated identical calls within one request are idempotent.`,
            inputSchema: {
                type: 'object', additionalProperties: false,
                required: [...(product ? ['productId'] : []), ...(quantity ? ['quantity'] : [])],
                properties: {
                    ...(product ? {
                        productId: { type: 'string', description: 'Actual imported external product ID.', maxLength: 200 },
                        variantId: { type: 'string', description: 'Verified variant only; unsupported variants are rejected.', maxLength: 200 },
                    } : {}),
                    ...(quantity || optionalQuantity ? { quantity: { type: 'number', description: 'Whole units, 1-99. Add is incremental; update is absolute. Remove with quantity subtracts units; without quantity removes the line.', minimum: 1, maximum: 99 } } : {}),
                },
            },
            handler: (input, context, signal) => cart.execute(name, input, context, signal),
        };
    });
}
//# sourceMappingURL=merchant-cart.tools.js.map