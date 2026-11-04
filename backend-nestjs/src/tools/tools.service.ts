import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth-context';
import { isUuidv7 } from '../common/ids/uuid';
import type { ToolDefinition } from '../agent/tools/interfaces/tool-definition.interface';
import { ToolRegistryService } from '../agent/tools/tool-registry.service';
import { ToolValidationService } from '../agent/tools/tool-validation.service';
import { ToolConfigurationRepository } from './tool-configuration.repository';
import { ToolSecretCipher } from './tool-secret-cipher';
import type { TenantToolUpdate } from './tools.dto';

const EMPTY_CONFIG_SCHEMA = {
  type: 'object' as const,
  required: [] as string[],
  properties: {},
  additionalProperties: false as const,
};

@Injectable()
export class ToolsService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly repository: ToolConfigurationRepository,
    private readonly validation: ToolValidationService,
    private readonly cipher: ToolSecretCipher,
  ) {}

  async list() {
    const definitions = this.registry.listDefinitions();
    const rows = await this.repository.listTenantTools(definitions);
    const items = rows.flatMap((row) => {
      const definition = this.registry.getTool(String(row.name));
      if (!definition) return [];
      return [{
        id: String(row.id),
        name: definition.name,
        displayName: String(row.display_name),
        description: definition.description,
        category: definition.category,
        enabled: Boolean(row.is_active) && row.tenant_enabled === 1 && row.assistant_enabled === true,
        requiresConfirmation: definition.requiresConfirmation,
        requiredPermissions: [...new Set([
          ...definition.requiredPermissions,
          ...parseStringArray(row.required_permissions),
          ...parseStringArray(row.extra_permissions),
        ])],
        configConfigured: row.config !== null && row.config !== undefined,
        secret: {
          configured: row.revoked_at == null &&
            row.last_rotated_at != null &&
            (row.expires_at == null || new Date(row.expires_at as string).getTime() > Date.now()),
          lastRotatedAt: row.last_rotated_at ?? null,
        },
      }];
    });
    return {
      items,
    };
  }

  async get(name: string) {
    const resolved = await this.resolve(name);
    const { definition, toolName } = resolved;
    const row = await this.repository.detail(toolName);
    const config = parseObject(row.config);
    return {
      id: String(row.id),
      name: definition.name,
      displayName: String(row.display_name),
      description: definition.description,
      category: definition.category,
      enabled: Boolean(row.is_active) && row.enabled === 1,
      requiredPermissions: [...new Set([
        ...definition.requiredPermissions,
        ...parseStringArray(row.required_permissions),
      ])],
      inputSchema: definition.inputSchema,
      configurationSchema: definition.configurationSchema ?? EMPTY_CONFIG_SCHEMA,
      tenantConfig: config,
      extraPermissions: parseStringArray(row.extra_permissions),
      secret: {
        configured: row.revoked_at == null && row.last_rotated_at != null &&
          (row.expires_at == null || new Date(row.expires_at as string).getTime() > Date.now()),
        lastRotatedAt: row.last_rotated_at ?? null,
        expiresAt: row.expires_at ?? null,
      },
    };
  }

  async update(name: string, input: TenantToolUpdate, user: AuthenticatedUser) {
    const { definition, toolName } = await this.resolve(name);
    if (input.config !== undefined) {
      rejectReservedKeys(input.config);
      input = {
        ...input,
        config: this.validation.validateToolInput(
          definition.name,
          input.config,
          definition.configurationSchema ?? EMPTY_CONFIG_SCHEMA,
        ),
      };
    }
    await this.repository.updateTenant(toolName, user.userId, input);
    return this.get(toolName);
  }

  async updateAssistant(name: string, assistantId: string, enabled: boolean) {
    const { toolName } = await this.resolve(name);
    if (!isUuidv7(assistantId)) throw new NotFoundException('Assistant not found.');
    await this.repository.setAssistantTool(toolName, assistantId, enabled);
    return { name: toolName, assistantId, enabled };
  }

  async secretStatus(name: string) {
    const { toolName } = await this.resolve(name);
    return this.repository.secretStatus(toolName);
  }

  async setSecret(name: string, value: string, expiresAt: string | null, user: AuthenticatedUser) {
    const { toolName } = await this.resolve(name);
    this.cipher.currentVersion();
    await this.repository.setSecret(toolName, user.userId, value, expiresAt);
    return this.repository.secretStatus(toolName);
  }

  async clearSecret(name: string) {
    const { toolName } = await this.resolve(name);
    await this.repository.revokeSecret(toolName);
    return this.repository.secretStatus(toolName);
  }

  private async resolve(reference: string): Promise<{ toolName: string; definition: ToolDefinition }> {
    const toolName = /^[1-9]\d{0,19}$/.test(reference) ? await this.repository.nameById(reference) : reference;
    const definition = this.registry.getTool(toolName);
    if (!definition) throw new NotFoundException('Tool not found.');
    return { toolName, definition };
  }
}

function rejectReservedKeys(value: Record<string, unknown>, depth = 0): void {
  if (depth > 5) throw new BadRequestException('Tool configuration is nested too deeply.');
  for (const [key, nested] of Object.entries(value)) {
    if (/(secret|password|token|credential|api.?key|authorization|private.?key)/i.test(key)) {
      throw new BadRequestException('Secret values must use the tenant-secret endpoint.');
    }
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      rejectReservedKeys(nested as Record<string, unknown>, depth + 1);
    }
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (value == null) return {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceUnavailableException('Stored tool configuration is invalid.');
  }
  return parsed as Record<string, unknown>;
}

function parseStringArray(value: unknown): string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}
