import type { ToolDefinition } from '../agent/tools/interfaces/tool-definition.interface';
import { MerchantCartService } from './merchant-cart.service';

export function createMerchantCartTools(cart: MerchantCartService): ToolDefinition[] {
  return (['add_to_cart', 'get_cart', 'update_cart_item', 'remove_cart_item', 'open_cart'] as const).map(name => {
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
            productId: { type: 'string' as const, description: 'Actual imported external product ID.', maxLength: 200 },
            variantId: { type: 'string' as const, description: 'Verified variant only; unsupported variants are rejected.', maxLength: 200 },
          } : {}),
          ...(quantity || optionalQuantity ? { quantity: { type: 'number' as const, description: 'Whole units, 1-99. Add is incremental; update is absolute. Remove with quantity subtracts units; without quantity removes the line.', minimum: 1, maximum: 99 } } : {}),
        },
      },
      handler: (input, context, signal) => cart.execute(name, input, context, signal),
    };
  });
}
