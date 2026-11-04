import { BadRequestException, ConflictException } from '@nestjs/common';
import { KnowledgeService } from '../knowledge.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolDefinition } from './interfaces/tool-definition.interface';
import { ToolConfigurationRepository } from '../../tools/tool-configuration.repository';

function createTestTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'Test tool used by the registry spec.',
    category: 'custom',
    requiredPermissions: [],
    enabled: true,
    requiresConfirmation: false,
    timeoutMs: 1000,
    tenantMode: 'ALL_TENANTS',
    inputSchema: {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: {},
    },
    handler: async () => ({}),
    ...overrides,
  };
}

describe('ToolRegistryService', () => {
  let registry: ToolRegistryService;

  beforeEach(async () => {
    registry = new ToolRegistryService(new KnowledgeService());
    await registry.onModuleInit();
  });

  it('registers the built-in knowledge_search tool on module init', () => {
    expect(registry.hasTool('knowledge_search')).toBe(true);

    const metadata = registry.listTools().find((t) => t.name === 'knowledge_search');

    expect(metadata).toBeDefined();
    expect(metadata?.category).toBe('knowledge');
    // Handlers must never leak through metadata.
    expect(metadata).not.toHaveProperty('handler');
  });

  it('registers a new tool (test 1: successful registration)', () => {
    registry.register(createTestTool({ name: 'demo_tool' }));

    expect(registry.hasTool('demo_tool')).toBe(true);
    expect(registry.getTool('demo_tool')?.description).toBe(
      'Test tool used by the registry spec.',
    );
  });

  it('rejects duplicate tool names (test 2: duplicate registration)', () => {
    expect(() =>
      registry.register(createTestTool({ name: 'knowledge_search' })),
    ).toThrow(ConflictException);
  });

  it('rejects RESTRICTED tools without an allowedTenants list', () => {
    expect(() =>
      registry.register(
        createTestTool({ name: 'bad_restricted', tenantMode: 'RESTRICTED' }),
      ),
    ).toThrow(BadRequestException);
  });

  it('unregisters tools', () => {
    registry.register(createTestTool({ name: 'removable_tool' }));
    expect(registry.unregister('removable_tool')).toBe(true);
    expect(registry.hasTool('removable_tool')).toBe(false);
    expect(registry.unregister('removable_tool')).toBe(false);
  });

  it('reports enabled state correctly', () => {
    registry.register(createTestTool({ name: 'disabled_tool', enabled: false }));

    expect(registry.isToolEnabled('knowledge_search')).toBe(true);
    expect(registry.isToolEnabled('disabled_tool')).toBe(false);
    expect(registry.isToolEnabled('never_registered')).toBe(false);
  });

  it('filters tool availability per tenant', () => {
    registry.register(
      createTestTool({
        name: 'tenant_b_only',
        tenantMode: 'RESTRICTED',
        allowedTenants: ['tenant-b'],
      }),
    );

    expect(registry.isToolAvailableToTenant('knowledge_search', 'tenant-a')).toBe(true);
    expect(registry.isToolAvailableToTenant('tenant_b_only', 'tenant-b')).toBe(true);
    expect(registry.isToolAvailableToTenant('tenant_b_only', 'tenant-a')).toBe(false);
    expect(registry.isToolAvailableToTenant('unknown_tool', 'tenant-a')).toBe(false);
  });

  it('lists tenant-scoped tools for /api/agent/tools', () => {
    registry.register(
      createTestTool({
        name: 'tenant_b_only',
        tenantMode: 'RESTRICTED',
        allowedTenants: ['tenant-b'],
      }),
    );

    const tenantATools = registry.listForTenant('tenant-a').map((t) => t.name);
    const tenantBTools = registry.listForTenant('tenant-b').map((t) => t.name);

    expect(tenantATools).toContain('knowledge_search');
    expect(tenantATools).not.toContain('tenant_b_only');

    expect(tenantBTools).toContain('knowledge_search');
    expect(tenantBTools).toContain('tenant_b_only');
  });

  it('uses persisted tenant enablement and denies missing overrides by default', async () => {
    const repository = {
      configured: true,
      syncCatalog: jest.fn().mockResolvedValue(undefined),
      listTenantTools: jest.fn().mockResolvedValue([
        { name: 'get_products', id: '1', is_active: 1, tenant_enabled: 0, assistant_enabled: true },
      ]),
    } as unknown as ToolConfigurationRepository;
    const dbRegistry = new ToolRegistryService(new KnowledgeService(), repository);
    await dbRegistry.onModuleInit();
    const tools = await dbRegistry.listForTenantAtCallTime('01900000-0000-7000-8000-000000000001');
    expect(tools.find((tool) => tool.name === 'get_products')?.enabled).toBe(false);
    expect(tools).toHaveLength(1);
  });
});
