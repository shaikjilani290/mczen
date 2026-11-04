"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGetProductDetailsTool = createGetProductDetailsTool;
function createGetProductDetailsTool(catalogues) {
    return {
        name: 'get_product_details',
        description: 'Retrieve the details of one product of the current tenant by product id (demonstration data).',
        category: 'products',
        requiredPermissions: ['products:read'],
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
                product: {
                    id: product.id,
                    name: product.name,
                    category: product.category,
                    price: product.price,
                    summary: product.summary,
                    inStock: product.stock > 0,
                },
            };
        },
    };
}
//# sourceMappingURL=get-product-details.tool.js.map