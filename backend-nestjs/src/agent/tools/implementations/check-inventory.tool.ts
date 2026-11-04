import { DEMO_PRODUCT_CATALOGUES, DemoProduct } from './demo-catalogues';
import { ToolDefinition } from '../interfaces/tool-definition.interface';

/**
 * check_inventory — demonstration tool.
 *
 * Reports stock availability for one product of the CURRENT TENANT. The
 * inventory lookup is scoped to the tenant's own catalogue: ids from other
 * tenants are indistinguishable from unknown ids (`found: false`), so no
 * inventory data ever crosses the tenant boundary.
 */
export function createCheckInventoryTool(
  catalogues: Readonly<Record<string, readonly DemoProduct[]>>,
): ToolDefinition {
  return {
    name: 'check_inventory',
    description:
      'Check the stock availability of one product of the current tenant by product id (demonstration data).',
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
      const productId = (input['productId'] as string).trim();
      // TENANT SCOPING: only the current tenant's catalogue is consulted.
      const catalogue = catalogues[context.tenantId] ?? [];
      const product = catalogue.find((item) => item.id === productId);

      if (!product) {
        // Identical response for unknown ids and other tenants' ids.
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
        productId: product.id,
        name: product.name,
        inStock: product.stock > 0,
        quantity: product.stock,
        note:
          product.stock > 0
            ? 'Available for ordering (demonstration only — no real orders are created).'
            : 'Currently out of stock.',
      };
    },
  };
}
