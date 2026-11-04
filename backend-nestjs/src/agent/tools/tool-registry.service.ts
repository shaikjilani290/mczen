import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { isUuidv7 } from '../../common/ids/uuid';
import { KnowledgeService } from '../knowledge.service';
import { ToolConfigurationRepository, ToolExecutionSettings } from '../../tools/tool-configuration.repository';
import { createKnowledgeSearchTool } from './implementations/knowledge-search.tool';
import { createGetProductsTool } from './implementations/get-products.tool';
import { createGetProductDetailsTool } from './implementations/get-product-details.tool';
import { createCheckInventoryTool } from './implementations/check-inventory.tool';
import { DEMO_PRODUCT_CATALOGUES } from './implementations/demo-catalogues';
import {
  ToolDefinition,
  ToolMetadata,
} from './interfaces/tool-definition.interface';

/**
 * McZEN tool registry.
 *
 * Responsibilities:
 * - Register / unregister tool definitions (with integrity validation).
 * - Look up tools and list them globally and per tenant.
 * - Answer availability/enabled queries used by the security lifecycle.
 *
 * This service owns NO execution logic: execution, permission checks, input
 * validation, timeouts and auditing live in ToolExecutorService and its
 * collaborator services.
 */
@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly knowledge: KnowledgeService,
    @Optional() private readonly configuration?: ToolConfigurationRepository,
  ) {}

  /**
   * Built-in tools are registered here. Each tool is a self-contained
   * definition; new tools follow the same pattern in their own
   * implementations/*.tool.ts file.
   */
  async onModuleInit(): Promise<void> {
    this.register(createKnowledgeSearchTool(this.knowledge));

    // Demonstration product tools (mock data, tenant-scoped, no external
    // services). Each is registered through the standard mechanism and
    // enforces its required permissions + input schema via the executor.
    this.register(createGetProductsTool(DEMO_PRODUCT_CATALOGUES));
    this.register(createGetProductDetailsTool(DEMO_PRODUCT_CATALOGUES));
    this.register(createCheckInventoryTool(DEMO_PRODUCT_CATALOGUES));
    if (this.configuration?.configured) {
      await this.configuration.syncCatalog([...this.tools.values()]);
    }
  }

  /**
   * Registers a tool definition.
   *
   * Throws when:
   * - a tool with the same name is already registered (duplicate protection)
   * - a RESTRICTED tool is declared without a non-empty allowedTenants list
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new ConflictException(
        `A tool with the name "${tool.name}" is already registered.`,
      );
    }

    if (
      tool.tenantMode === 'RESTRICTED' &&
      (!tool.allowedTenants || tool.allowedTenants.length === 0)
    ) {
      throw new BadRequestException(
        `Tool "${tool.name}" is RESTRICTED but declares no allowedTenants.`,
      );
    }

    this.tools.set(tool.name, tool);
  }

  /** Unregisters a tool. Returns true when a tool was removed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Resolves a tool definition, or undefined when unknown. */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Code-bound definitions used to reconcile the persistent catalog. */
  listDefinitions(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Whether a tool with the given name is registered. */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /** Whether the given tool is registered AND enabled. */
  isToolEnabled(name: string): boolean {
    return this.tools.get(name)?.enabled ?? false;
  }

  /**
   * Whether the tool is available to the given tenant, based on the tool's
   * tenant availability configuration (never on model-generated arguments).
   */
  isToolAvailableToTenant(name: string, tenantId: string): boolean {
    const tool = this.tools.get(name);

    if (!tool) {
      return false;
    }

    if (tool.tenantMode === 'ALL_TENANTS') {
      return true;
    }

    return tool.allowedTenants?.includes(tenantId) ?? false;
  }

  /**
   * Lists every registered tool (metadata only — handlers are never exposed).
   */
  listTools(): ToolMetadata[] {
    return [...this.tools.values()].map((tool) => toMetadata(tool));
  }

  /**
   * Lists the tools available to a specific tenant (metadata only).
   */
  listForTenant(tenantId: string): ToolMetadata[] {
    return [...this.tools.values()]
      .filter(
        (tool) =>
          tool.tenantMode === 'ALL_TENANTS' ||
          tool.allowedTenants?.includes(tenantId) === true,
      )
      .map((tool) => toMetadata(tool));
  }

  /** Code-owned handlers with current tenant enablement read from MySQL. */
  async listForTenantAtCallTime(tenantId: string, assistantId?: string): Promise<ToolMetadata[]> {
    if (!this.configuration?.configured) return this.listForTenant(tenantId);
    if (!isUuidv7(tenantId)) {
      return process.env.NODE_ENV === 'production' ? [] : this.listForTenant(tenantId);
    }
    const rows = await this.configuration.listTenantTools([...this.tools.values()], assistantId);
    return rows.map((row) => {
      const definition = this.tools.get(String(row.name));
      if (!definition) return undefined;
      const metadata = toMetadata(definition);
      metadata.enabled = row.is_active === 1 && row.tenant_enabled === 1 && row.assistant_enabled === true;
      metadata.requiredPermissions = [
        ...new Set([
          ...metadata.requiredPermissions,
          ...readStringArray(row.required_permissions),
          ...readStringArray(row.extra_permissions),
        ]),
      ];
      return metadata;
    }).filter((metadata): metadata is ToolMetadata => metadata !== undefined);
  }

  async executionSettings(
    name: string,
    tenantId: string,
    definition: ToolDefinition,
    assistantId?: string,
  ): Promise<ToolExecutionSettings> {
    if (!this.configuration?.configured || !isUuidv7(tenantId)) {
      const available = this.isToolAvailableToTenant(name, tenantId);
      return {
        available,
        enabled: definition.enabled,
        requiredPermissions: [...definition.requiredPermissions],
        config: {},
        secrets: {},
        timeoutMs: definition.timeoutMs,
        requiresConfirmation: definition.requiresConfirmation,
      };
    }
    return this.configuration.executionSettings(name, definition, assistantId);
  }

  async executionSecrets(name: string, tenantId: string): Promise<Record<string, string>> {
    if (!this.configuration?.configured || !isUuidv7(tenantId)) return {};
    return this.configuration.executionSecrets(name);
  }
}

/** Strips handler internals and copies mutable fields defensively. */
function toMetadata(tool: ToolDefinition): ToolMetadata {
  return {
    name: tool.name,
    description: tool.description,
    category: tool.category,
    requiredPermissions: [...tool.requiredPermissions],
    enabled: tool.enabled,
    requiresConfirmation: tool.requiresConfirmation,
    inputSchema: {
      ...tool.inputSchema,
      required: [...tool.inputSchema.required],
      properties: Object.fromEntries(
        Object.entries(tool.inputSchema.properties).map(
          ([property, schema]) => [property, { ...schema }],
        ),
      ),
    },
  };
}

function readStringArray(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}
