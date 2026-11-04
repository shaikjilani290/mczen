import { DEMO_PRODUCT_CATALOGUES, DemoProduct } from './demo-catalogues';
import { ToolDefinition } from '../interfaces/tool-definition.interface';

/**
 * get_product_details — demonstration tool.
 *
 * Retrieves one product by id from the CURRENT TENANT's mock catalogue.
 *
 * TENANT OWNERSHIP: the lookup happens inside the tenant's own catalogue, so
 * a product id belonging to another tenant is indistinguishable from an
 * unknown id — both return `found: false` with a generic message. This
 * avoids leaking whether a foreign product id exists (no data ever crosses
 * the tenant boundary).
 */
export function createGetProductDetailsTool(
  catalogues: Readonly<Record<string, readonly DemoProduct[]>>,
): ToolDefinition {
  return {
    name: 'get_product_details',
    description:
      'Retrieve the details of one product of the current tenant by product id (demonstration data).',
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
      const productId = (input['productId'] as string).trim();
      // TENANT SCOPING: search only the current tenant's catalogue.
      const catalogue = catalogues[context.tenantId] ?? [];
      const product = catalogue.find((item) => item.id === productId);

      if (!product) {
        // Same response for unknown ids AND ids owned by another tenant —
        // no information about other tenants is ever revealed.
        return {
          demonstrationData: true,
          tenantId: context.tenantId,
          found: false,
          message:
            'No product with this id exists in the current tenant catalogue.',
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
