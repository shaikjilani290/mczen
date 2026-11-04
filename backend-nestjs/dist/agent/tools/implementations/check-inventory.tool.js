"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCheckInventoryTool = createCheckInventoryTool;
function createCheckInventoryTool(catalogues) {
    return {
        name: 'check_inventory',
        description: 'Check the stock availability of one product of the current tenant by product id (demonstration data).',
        category: 'products',
        requiredPermissions: ['inventory:read'],
        enabled: true,
        requiresConfirmation: false,
        timeoutMs: 5000,
        tenantMode: 'ALL_TENANTS',
        inputSchema: {
            type: 'object',
            required: ['productId'],
            additionalProperties: false,
            properties: {
                productId: {
                    type: 'string',
                    description: 'The product id, e.g. "prod-a-001".',
                    maxLength: 50,
                },
            },
        },
        handler: async (input, context) => {
            const productId = input['productId'].trim();
            const catalogue = catalogues[context.tenantId] ?? [];
            const product = catalogue.find((item) => item.id === productId);
            if (!product) {
                return {
                    demonstrationData: true,
                    tenantId: context.tenantId,
                    found: false,
                    message: 'No product with this id exists in the current tenant catalogue.',
                };
            }
            return {
                demonstrationData: true,
                tenantId: context.tenantId,
                found: true,
                productId: product.id,
                name: product.name,
                inStock: product.stock > 0,
                quantity: product.stock,
                note: product.stock > 0
                    ? 'Available for ordering (demonstration only — no real orders are created).'
                    : 'Currently out of stock.',
            };
        },
    };
}
//# sourceMappingURL=check-inventory.tool.js.map