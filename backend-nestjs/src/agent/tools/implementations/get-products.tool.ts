import { DEMO_PRODUCT_CATALOGUES, DemoProduct } from './demo-catalogues';
import { ToolDefinition } from '../interfaces/tool-definition.interface';

/** Hard cap on results per call, independent of the caller-provided limit. */
const MAX_RESULT_LIMIT = 20;

/**
 * get_products — demonstration tool.
 *
 * Searches the CURRENT TENANT's mock catalogue with optional text search,
 * category filter, and a safe result limit. Data is resolved strictly from
 * the backend-established execution context; model-supplied tenant hints are
 * impossible (undeclared properties are rejected by the validation service).
 */
export function createGetProductsTool(
  catalogues: Readonly<Record<string, readonly DemoProduct[]>>,
): ToolDefinition {
  return {
    name: 'get_products',
    description:
      'Retrieve the products of the current tenant (demonstration data). Supports text search, category filter and a result limit.',
    category: 'products',
    requiredPermissions: ['products:read'],
    enabled: true,
    requiresConfirmation: false,
    timeoutMs: 5000,
    tenantMode: 'ALL_TENANTS',
    inputSchema: {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: {
        search: {
          type: 'string',
          description: 'Optional text to search in product names and summaries.',
          maxLength: 100,
        },
        category: {
          type: 'string',
          description: 'Optional category to filter by (e.g. sports, electronics).',
          maxLength: 50,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of products to return (1-20).',
          minimum: 1,
          maximum: MAX_RESULT_LIMIT,
        },
      },
    },
    configurationSchema: {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: {
        defaultCategory: {
          type: 'string',
          description: 'Optional default category when the caller does not specify one.',
          maxLength: 50,
        },
        defaultLimit: {
          type: 'number',
          description: 'Default result count when the caller does not specify a limit.',
          minimum: 1,
          maximum: MAX_RESULT_LIMIT,
        },
      },
    },
    handler: async (input, context, _signal, runtime) => {
      // TENANT SCOPING: the catalogue is selected by the backend-verified
      // tenant id only. An unknown tenant simply has no catalogue.
      const catalogue = catalogues[context.tenantId] ?? [];

      const search = typeof input['search'] === 'string' ? input['search'].trim().toLowerCase() : '';
      const configuredCategory = runtime?.config.defaultCategory;
      const category = typeof input['category'] === 'string'
        ? input['category'].trim().toLowerCase()
        : typeof configuredCategory === 'string' ? configuredCategory.trim().toLowerCase() : '';
      const configuredLimit = runtime?.config.defaultLimit;
      const requestedLimit = typeof input['limit'] === 'number'
        ? input['limit']
        : typeof configuredLimit === 'number' ? configuredLimit : MAX_RESULT_LIMIT;
      const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), MAX_RESULT_LIMIT);

      let matches = catalogue;

      if (category.length > 0) {
        matches = matches.filter(
          (product) => product.category.toLowerCase() === category,
        );
      }

      if (search.length > 0) {
        matches = matches.filter(
          (product) =>
            product.name.toLowerCase().includes(search) ||
            product.summary.toLowerCase().includes(search) ||
            product.category.toLowerCase().includes(search),
        );
      }

      return {
        demonstrationData: true,
        tenantId: context.tenantId,
        total: matches.length,
        returned: Math.min(matches.length, limit),
        products: matches.slice(0, limit).map((product) => ({
          id: product.id,
          name: product.name,
          category: product.category,
          price: product.price,
          summary: product.summary,
          inStock: product.stock > 0,
        })),
      };
    },
  };
}
