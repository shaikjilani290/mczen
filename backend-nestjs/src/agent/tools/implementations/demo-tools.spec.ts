import type { AgentExecutionContext } from '../../context/agent-execution-context.interface';
import { KnowledgeService } from '../../knowledge.service';
import { ToolAuditService } from '../tool-audit.service';
import { ToolExecutorService } from '../tool-executor.service';
import { ToolPermissionService } from '../tool-permission.service';
import { ToolRegistryService } from '../tool-registry.service';
import { ToolValidationService } from '../tool-validation.service';
import { DEMO_PRODUCT_CATALOGUES } from './demo-catalogues';

const TENANT_A_PERMISSIONS = [
  'knowledge:read',
  'products:read',
  'inventory:read',
];
const TENANT_B_PERMISSIONS = [
  'knowledge:read',
  'products:read',
  'inventory:read',
];

function contextFor(
  tenantId: 'tenant-a' | 'tenant-b',
): AgentExecutionContext {
  return {
    tenantId,
    permissions: tenantId === 'tenant-a' ? TENANT_A_PERMISSIONS : TENANT_B_PERMISSIONS,
    requestId: `req-demo-${tenantId}`,
  };
}

interface DemoToolResult {
  [key: string]: unknown;
}

async function execute(
  executor: ToolExecutorService,
  toolName: string,
  input: unknown,
  tenantId: 'tenant-a' | 'tenant-b',
): Promise<DemoToolResult> {
  const result = await executor.execute(toolName, input, contextFor(tenantId));

  // Every demo-tool test expects a structured success; failures use
  // toMatchObject assertions in their dedicated tests.
  expect(result.ok).toBe(true);

  return (result as { ok: true; data: DemoToolResult }).data;
}

describe('Demonstration product tools (Phase 4)', () => {
  let registry: ToolRegistryService;
  let audit: ToolAuditService;
  let executor: ToolExecutorService;

  beforeEach(async () => {
    registry = new ToolRegistryService(new KnowledgeService());
    await registry.onModuleInit();
    audit = new ToolAuditService();
    executor = new ToolExecutorService(
      registry,
      new ToolPermissionService(),
      new ToolValidationService(),
      audit,
    );
  });

  describe('tool registration', () => {
    it('registers all three demonstration tools with permissions and schemas', () => {
      const names = registry.listTools().map((tool) => tool.name);

      expect(names).toEqual(
        expect.arrayContaining([
          'knowledge_search',
          'get_products',
          'get_product_details',
          'check_inventory',
        ]),
      );

      const products = registry.getTool('get_products');
      expect(products?.requiredPermissions).toEqual(['products:read']);

      const details = registry.getTool('get_product_details');
      expect(details?.requiredPermissions).toEqual(['products:read']);

      const inventory = registry.getTool('check_inventory');
      expect(inventory?.requiredPermissions).toEqual(['inventory:read']);
    });
  });

  describe('get_products — tenant-a (test: all three tools for tenant-a)', () => {
    it('returns only tenant-a products with demonstrationData flag', async () => {
      const data = await execute(executor, 'get_products', {}, 'tenant-a');

      expect(data['demonstrationData']).toBe(true);
      expect(data['tenantId']).toBe('tenant-a');

      const products = data['products'] as Array<{ id: string }>;
      expect(products.length).toBeGreaterThan(0);
      for (const product of products) {
        expect(product.id).toMatch(/^prod-a-/);
      }
    });

    it('filters by search text', async () => {
      const data = await execute(
        executor,
        'get_products',
        { search: 'yoga' },
        'tenant-a',
      );

      const products = data['products'] as Array<{ id: string; name: string }>;
      expect(products).toHaveLength(1);
      expect(products[0]?.name).toBe('ZenFlex Yoga Mat');
    });

    it('filters by category', async () => {
      const data = await execute(
        executor,
        'get_products',
        { category: 'sports' },
        'tenant-a',
      );

      const products = data['products'] as Array<{ id: string; category: string }>;
      expect(products.length).toBe(2);
      for (const product of products) {
        expect(product.category).toBe('sports');
      }
    });

    it('enforces the safe result limit and reports the total', async () => {
      const data = await execute(
        executor,
        'get_products',
        { limit: 2 },
        'tenant-a',
      );

      const products = data['products'] as Array<{ id: string }>;
      expect(products).toHaveLength(2);
      expect(data['total']).toBe(5);
      expect(data['returned']).toBe(2);
    });
  });

  describe('get_products — tenant-b (test: all three tools for tenant-b)', () => {
    it('returns only tenant-b products — never tenant-a data', async () => {
      const data = await execute(executor, 'get_products', {}, 'tenant-b');

      expect(data['demonstrationData']).toBe(true);
      expect(data['tenantId']).toBe('tenant-b');

      const products = data['products'] as Array<{ id: string }>;
      expect(products.length).toBe(4);
      for (const product of products) {
        expect(product.id).toMatch(/^prod-b-/);
      }

      // No tenant-a product data may appear anywhere in the payload.
      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain('prod-a');
      expect(serialized).not.toContain('ZenRun');
    });
  });

  describe('get_product_details', () => {
    it('returns own-tenant product details for tenant-a', async () => {
      const data = await execute(
        executor,
        'get_product_details',
        { productId: 'prod-a-003' },
        'tenant-a',
      );

      expect(data['found']).toBe(true);
      expect(data['demonstrationData']).toBe(true);
      const product = data['product'] as { id: string; name: string };
      expect(product.id).toBe('prod-a-003');
      expect(product.name).toBe('ZenBrew Coffee Maker');
    });

    it('returns own-tenant product details for tenant-b', async () => {
      const data = await execute(
        executor,
        'get_product_details',
        { productId: 'prod-b-002' },
        'tenant-b',
      );

      expect(data['found']).toBe(true);
      const product = data['product'] as { id: string };
      expect(product.id).toBe('prod-b-002');
    });

    it('rejects cross-tenant product id access SAFELY — no data leak (test: cross-tenant)', async () => {
      // tenant-a asks for a tenant-b product.
      const data = await execute(
        executor,
        'get_product_details',
        { productId: 'prod-b-001' },
        'tenant-a',
      );

      expect(data['found']).toBe(false);
      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain('prod-b-001');
      expect(serialized).not.toContain('Textbook');
      expect(serialized).not.toContain('tenant-b');
      // Indistinguishable from an unknown id.
      const unknown = await execute(
        executor,
        'get_product_details',
        { productId: 'prod-a-999' },
        'tenant-a',
      );
      expect(unknown).toEqual(data);
    });
  });

  describe('check_inventory', () => {
    it('reports stock for an own-tenant product (tenant-a)', async () => {
      const data = await execute(
        executor,
        'check_inventory',
        { productId: 'prod-a-001' },
        'tenant-a',
      );

      expect(data['found']).toBe(true);
      expect(data['inStock']).toBe(true);
      expect(data['quantity']).toBe(42);
    });

    it('reports out-of-stock state (tenant-b)', async () => {
      const data = await execute(
        executor,
        'check_inventory',
        { productId: 'prod-b-004' },
        'tenant-b',
      );

      expect(data['found']).toBe(true);
      expect(data['inStock']).toBe(false);
      expect(data['quantity']).toBe(0);
    });

    it('rejects cross-tenant inventory access SAFELY — no stock data leaks', async () => {
      // tenant-b asks for tenant-a inventory.
      const data = await execute(
        executor,
        'check_inventory',
        { productId: 'prod-a-001' },
        'tenant-b',
      );

      expect(data['found']).toBe(false);
      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain('prod-a-001');
      expect(serialized).not.toContain('ZenRun');
      expect(serialized).not.toContain('tenant-a');
      expect(serialized).not.toContain('"quantity"');
    });
  });

  describe('security rejections', () => {
    it('rejects invalid arguments (unknown property, wrong type, missing id)', async () => {
      const unknownProperty = await executor.execute(
        'get_products',
        { tenantId: 'tenant-b' }, // spoofed tenant property — undeclared
        contextFor('tenant-a'),
      );
      const wrongType = await executor.execute(
        'get_products',
        { limit: 'many' },
        contextFor('tenant-a'),
      );
      const outOfRange = await executor.execute(
        'get_products',
        { limit: 500 },
        contextFor('tenant-a'),
      );
      const missingId = await executor.execute(
        'get_product_details',
        {},
        contextFor('tenant-a'),
      );

      for (const result of [unknownProperty, wrongType, outOfRange, missingId]) {
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'INVALID_INPUT' },
        });
      }
    });

    it('rejects callers without the required permissions', async () => {
      const noProducts = await executor.execute(
        'get_products',
        {},
        { tenantId: 'tenant-d', permissions: ['knowledge:read'], requestId: 'req-d' },
      );
      const noInventory = await executor.execute(
        'check_inventory',
        { productId: 'prod-a-001' },
        { tenantId: 'tenant-c', permissions: ['knowledge:read'], requestId: 'req-c' },
      );

      expect(noProducts).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
      expect(noInventory).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
      // And nothing from the catalogue may leak in the audit trail.
      expect(JSON.stringify(audit.list())).not.toContain('prod-');
    });
  });

  describe('existing knowledge_search (regression)', () => {
    it('still works through the same executor and registry', async () => {
      const data = await execute(
        executor,
        'knowledge_search',
        { query: 'earning plan benefits' },
        'tenant-a',
      );

      const documents = data as unknown as Array<{ id: string }>;
      expect(documents.length).toBeGreaterThan(0);
      expect(documents[0]?.id).toBe('plan-001');
    });
  });
});
