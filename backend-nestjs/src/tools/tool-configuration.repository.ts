import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { isUuidv7, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { TenantScopedRepository } from '../common/tenant/tenant-scoped.repository';
import type { ToolDefinition } from '../agent/tools/interfaces/tool-definition.interface';
import { ToolSecretCipher } from './tool-secret-cipher';

type Row = Record<string, unknown>;

export interface ToolExecutionSettings {
  available: boolean;
  enabled: boolean;
  requiredPermissions: string[];
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  timeoutMs: number;
  requiresConfirmation: boolean;
}

@Injectable()
export class ToolConfigurationRepository extends TenantScopedRepository<ObjectLiteral> {
  constructor(
    @Optional() @InjectDataSource() private readonly source?: DataSource,
    private readonly secretCipher?: ToolSecretCipher,
  ) {
    super(undefined as unknown as Repository<ObjectLiteral>);
  }

  get configured(): boolean { return Boolean(this.source); }

  private get database(): DataSource {
    if (!this.source) throw new ServiceUnavailableException('Tool configuration is unavailable.');
    return this.source;
  }

  private tenant(): { id: string; binary: Buffer } {
    const id = this.currentTenantId();
    return { id, binary: uuidToBinary(id) };
  }

  private async run(sql: string, params: unknown[] = [], manager?: EntityManager): Promise<Row[]> {
    return (manager ?? this.database).query(sql, params) as Promise<Row[]>;
  }

  async syncCatalog(definitions: readonly ToolDefinition[]): Promise<void> {
    await this.database.transaction(async (manager) => {
      for (const definition of definitions) {
        await manager.query(
          `INSERT INTO \`tools\` (\`name\`,\`display_name\`,\`description\`,\`category\`,\`input_schema\`,
             \`handler_ref\`,\`timeout_ms\`,\`requires_confirmation\`,\`requires_permission_set\`)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE \`display_name\`=VALUES(\`display_name\`), \`description\`=VALUES(\`description\`),
             \`category\`=VALUES(\`category\`), \`input_schema\`=VALUES(\`input_schema\`), \`handler_ref\`=VALUES(\`handler_ref\`),
             \`timeout_ms\`=VALUES(\`timeout_ms\`), \`requires_confirmation\`=VALUES(\`requires_confirmation\`),
             \`requires_permission_set\`=VALUES(\`requires_permission_set\`)`,
          [
            definition.name,
            definition.name.replace(/_/g, ' '),
            definition.description,
            definition.category,
            JSON.stringify(definition.inputSchema),
            definition.name,
            definition.timeoutMs,
            definition.requiresConfirmation ? 1 : 0,
            definition.requiredPermissions.length ? 1 : 0,
          ],
        );
        const rows = await manager.query('SELECT `id` FROM `tools` WHERE `name`=?', [definition.name]) as Row[];
        const toolId = rows[0]?.id;
        if (toolId === undefined) throw new ServiceUnavailableException('Tool catalog synchronization failed.');
        await manager.query('DELETE FROM `tool_permissions` WHERE `tool_id`=?', [toolId]);
        for (const permission of definition.requiredPermissions) {
          await manager.query(
            'INSERT INTO `permissions` (`key`,`description`,`category`) VALUES (?,?,?) ON DUPLICATE KEY UPDATE `key`=VALUES(`key`)',
            [permission, `Required to use ${definition.name}.`, permission.split(':')[0]],
          );
          await manager.query(
            'INSERT INTO `tool_permissions` (`tool_id`,`permission_id`) SELECT ?,`id` FROM `permissions` WHERE `key`=?',
            [toolId, permission],
          );
        }
      }
    });
  }

  async listTenantTools(definitions: readonly ToolDefinition[], assistantId?: string): Promise<Row[]> {
    const { binary } = this.tenant();
    const rows = await this.run(
      `SELECT t.\`id\`,t.\`name\`,t.\`display_name\`,t.\`description\`,t.\`category\`,t.\`is_active\`,
          tt.\`enabled\` AS \`tenant_enabled\`,tt.\`extra_permissions\`,tt.\`max_calls_per_conversation\`,
          tc.\`config\`,tc.\`is_active\` AS \`config_active\`,
          ts.\`last_rotated_at\`,ts.\`expires_at\`,ts.\`revoked_at\`
       FROM \`tools\` t
       LEFT JOIN \`tenant_tools\` tt ON tt.\`tool_id\`=t.\`id\` AND tt.\`tenant_id\`=?
       LEFT JOIN \`tool_configurations\` tc ON tc.\`tool_id\`=t.\`id\` AND tc.\`tenant_id\`=?
       LEFT JOIN \`tool_secrets\` ts ON ts.\`tenant_id\`=? AND ts.\`key_label\`=CONCAT(t.\`name\`,':credential')
       ORDER BY t.\`category\`,t.\`name\``,
      [binary, binary, binary],
    );
    const names = new Set(definitions.map((definition) => definition.name));
    const filtered = rows.filter((row) => names.has(String(row.name)));
    const permissions = await this.run(
      `SELECT t.\`name\`,p.\`key\` FROM \`tool_permissions\` tp
       JOIN \`tools\` t ON t.\`id\`=tp.\`tool_id\`
       JOIN \`permissions\` p ON p.\`id\`=tp.\`permission_id\`
       WHERE t.\`name\` IN (${[...names].map(() => '?').join(',') || "''"})`,
      [...names],
    );
    const permissionMap = new Map<string, string[]>();
    for (const permission of permissions) {
      const key = String(permission.name);
      permissionMap.set(key, [...(permissionMap.get(key) ?? []), String(permission.key)]);
    }
    for (const row of filtered) row.required_permissions = permissionMap.get(String(row.name)) ?? [];
    let targetAssistant = assistantId;
    if (!targetAssistant) {
      const defaults = await this.run(
        'SELECT `id` FROM `assistants` WHERE `tenant_id`=? AND `is_default`=1 AND `deleted_at` IS NULL LIMIT 1',
        [binary],
      );
      if (defaults[0]) {
        const bytes = Buffer.from(defaults[0].id as Uint8Array);
        const hex = bytes.toString('hex');
        targetAssistant = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
    }
    if (targetAssistant) {
      if (!isUuidv7(targetAssistant)) throw new NotFoundException('Assistant not found.');
      const overlay = await this.run(
        'SELECT `tool_id`,`enabled` FROM `assistant_tools` WHERE `tenant_id`=? AND `assistant_id`=?',
        [binary, uuidToBinary(targetAssistant)],
      );
      const toolIds = new Map(overlay.map((entry) => [String(entry.tool_id), entry.enabled === 1]));
      if (assistantId || overlay.length > 0) {
        for (const row of filtered) {
          row.assistant_enabled = toolIds.get(String(row.id)) === true;
        }
      } else {
        for (const row of filtered) row.assistant_enabled = true;
      }
    } else {
      for (const row of filtered) row.assistant_enabled = !assistantId;
    }
    return filtered;
  }

  async executionSettings(
    name: string,
    definition: ToolDefinition,
    assistantId?: string,
  ): Promise<ToolExecutionSettings> {
    const { binary } = this.tenant();
    const rows = await this.run(
      `SELECT t.\`id\`,t.\`is_active\`,t.\`timeout_ms\`,t.\`requires_confirmation\`,
          tt.\`enabled\`,tt.\`extra_permissions\`,tc.\`config\`,tc.\`is_active\` AS \`config_active\`
       FROM \`tools\` t
       LEFT JOIN \`tenant_tools\` tt ON tt.\`tool_id\`=t.\`id\` AND tt.\`tenant_id\`=?
       LEFT JOIN \`tool_configurations\` tc ON tc.\`tool_id\`=t.\`id\` AND tc.\`tenant_id\`=?
       WHERE t.\`name\`=? LIMIT 1`,
      [binary, binary, name],
    );
    const row = rows[0];
    if (!row) return { available: false, enabled: false, requiredPermissions: [], config: {}, secrets: {}, timeoutMs: definition.timeoutMs, requiresConfirmation: definition.requiresConfirmation };
    const toolId = row.id;
    const available = row.enabled !== null && row.enabled !== undefined;
    let targetAssistant = assistantId;
    if (!targetAssistant) {
      const defaults = await this.run(
        'SELECT `id` FROM `assistants` WHERE `tenant_id`=? AND `is_default`=1 AND `deleted_at` IS NULL LIMIT 1',
        [binary],
      );
      if (defaults[0]) {
        const hex = Buffer.from(defaults[0].id as Uint8Array).toString('hex');
        targetAssistant = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
    }
    let assistantEnabled = true;
    if (targetAssistant) {
      if (!isUuidv7(targetAssistant)) throw new NotFoundException('Assistant not found.');
      const assistant = await this.run(
        'SELECT `enabled` FROM `assistant_tools` WHERE `tenant_id`=? AND `assistant_id`=? AND `tool_id`=?',
        [binary, uuidToBinary(targetAssistant), toolId],
      );
      if (assistant[0]) {
        assistantEnabled = assistant[0].enabled === 1 || assistant[0].enabled === true;
      } else if (assistantId) {
        assistantEnabled = false;
      } else {
        const configured = await this.run(
          'SELECT 1 AS `configured` FROM `assistant_tools` WHERE `tenant_id`=? AND `assistant_id`=? LIMIT 1',
          [binary, uuidToBinary(targetAssistant)],
        );
        if (configured.length) assistantEnabled = false;
      }
    }
    const permissions = await this.run(
      `SELECT p.\`key\` FROM \`tool_permissions\` tp JOIN \`permissions\` p ON p.\`id\`=tp.\`permission_id\`
       WHERE tp.\`tool_id\`=? ORDER BY p.\`key\``,
      [toolId],
    );
    const extras = parseJsonArray(row.extra_permissions);
    const configured = parseJsonObject(row.config);
    return {
      available,
      enabled: row.is_active === 1 &&
        row.enabled === 1 &&
        assistantEnabled &&
        (row.config_active === null || row.config_active === 1 || row.config_active === true),
      requiredPermissions: [...new Set([
        ...permissions.map((permission) => String(permission.key)),
        ...definition.requiredPermissions,
        ...extras,
      ])],
      config: configured,
      secrets: {},
      timeoutMs: Number(row.timeout_ms),
      requiresConfirmation: row.requires_confirmation === 1 || row.requires_confirmation === true,
    };
  }

  async executionSecrets(name: string): Promise<Record<string, string>> {
    if (!this.secretCipher) throw new ServiceUnavailableException('Tool secret storage is not configured.');
    const { id: tenantId, binary } = this.tenant();
    const rows = await this.run(
      `SELECT \`key_label\`,\`key_version\`,\`ciphertext\`,\`iv\`,\`auth_tag\`
       FROM \`tool_secrets\` WHERE \`tenant_id\`=? AND \`key_label\`=? AND \`revoked_at\` IS NULL
         AND (\`expires_at\` IS NULL OR \`expires_at\`>UTC_TIMESTAMP(3))`,
      [binary, `${name}:credential`],
    );
    if (!rows[0]) return {};
    const secret = rows[0];
    const value = this.secretCipher.decrypt({
      keyVersion: Number(secret.key_version),
      ciphertext: Buffer.from(secret.ciphertext as Uint8Array),
      iv: Buffer.from(secret.iv as Uint8Array),
      authTag: Buffer.from(secret.auth_tag as Uint8Array),
    }, secretAad(tenantId, name, String(secret.key_label), Number(secret.key_version)));
    await this.database.query(
      'UPDATE `tool_secrets` SET `last_used_at`=UTC_TIMESTAMP(3) WHERE `tenant_id`=? AND `key_label`=? AND `revoked_at` IS NULL',
      [binary, `${name}:credential`],
    );
    return { credential: value };
  }

  async detail(name: string): Promise<Row> {
    const { binary } = this.tenant();
    const rows = await this.run(
      `SELECT t.\`id\`,t.\`name\`,t.\`display_name\`,t.\`description\`,t.\`category\`,t.\`input_schema\`,t.\`is_active\`,
          tt.\`enabled\`,tt.\`extra_permissions\`,tt.\`max_calls_per_conversation\`,
          tc.\`config\`,tc.\`is_active\` AS \`config_active\`,
          ts.\`last_rotated_at\`,ts.\`expires_at\`,ts.\`revoked_at\`
       FROM \`tools\` t
       LEFT JOIN \`tenant_tools\` tt ON tt.\`tool_id\`=t.\`id\` AND tt.\`tenant_id\`=?
       LEFT JOIN \`tool_configurations\` tc ON tc.\`tool_id\`=t.\`id\` AND tc.\`tenant_id\`=?
       LEFT JOIN \`tool_secrets\` ts ON ts.\`tenant_id\`=? AND ts.\`key_label\`=CONCAT(t.\`name\`,':credential')
       WHERE t.\`name\`=? LIMIT 1`,
      [binary, binary, binary, name],
    );
    if (!rows[0]) throw new NotFoundException('Tool not found.');
    const row = rows[0];
    const permissions = await this.run(
      `SELECT p.\`key\` FROM \`tool_permissions\` tp JOIN \`permissions\` p ON p.\`id\`=tp.\`permission_id\`
       WHERE tp.\`tool_id\`=? ORDER BY p.\`key\``,
      [row.id],
    );
    row.required_permissions = permissions.map((permission) => String(permission.key));
    return rows[0];
  }

  async updateTenant(
    name: string,
    actorId: string,
    update: { enabled?: boolean; extraPermissions?: string[]; config?: Record<string, unknown> },
  ): Promise<void> {
    const { binary } = this.tenant();
    const id = uuidToBinary(actorId);
    await this.database.transaction(async (manager) => {
      const toolId = await this.toolId(manager, name);
      if (update.extraPermissions) {
        const values = await this.run(
          `SELECT \`key\` FROM \`permissions\` WHERE \`key\` IN (${update.extraPermissions.map(() => '?').join(',') || "''"})`,
          update.extraPermissions,
          manager,
        );
        if (values.length !== update.extraPermissions.length) throw new BadRequestException('Unknown permission key.');
      }
      const existing = await this.run(
        'SELECT `id` FROM `tenant_tools` WHERE `tenant_id`=? AND `tool_id`=?',
        [binary, toolId],
        manager,
      );
      if (existing[0]) {
        await manager.query(
          `UPDATE \`tenant_tools\` SET \`enabled\`=COALESCE(?,\`enabled\`),\`extra_permissions\`=COALESCE(?,\`extra_permissions\`),
             \`updated_by\`=? WHERE \`id\`=?`,
          [
            update.enabled === undefined ? null : update.enabled ? 1 : 0,
            update.extraPermissions === undefined ? null : JSON.stringify(update.extraPermissions),
            id,
            existing[0].id,
          ],
        );
      } else {
        await manager.query(
          `INSERT INTO \`tenant_tools\` (\`id\`,\`tenant_id\`,\`tool_id\`,\`enabled\`,\`extra_permissions\`,\`max_calls_per_conversation\`,\`updated_by\`)
           VALUES (?,?,?,?,?,?,?)`,
          [
            uuidToBinary(newUuidv7()),
            binary,
            toolId,
            update.enabled === true ? 1 : 0,
            update.extraPermissions === undefined ? null : JSON.stringify(update.extraPermissions),
            null,
            id,
          ],
        );
      }
      if (update.config !== undefined) {
        await manager.query(
          `INSERT INTO \`tool_configurations\` (\`id\`,\`tenant_id\`,\`tool_id\`,\`config\`,\`is_active\`,\`updated_by\`)
           VALUES (?,?,?,?,1,?) ON DUPLICATE KEY UPDATE \`config\`=VALUES(\`config\`),\`is_active\`=1,\`updated_by\`=VALUES(\`updated_by\`)`,
          [uuidToBinary(newUuidv7()), binary, toolId, JSON.stringify(update.config), id],
        );
      }
    });
  }

  async setAssistantTool(name: string, assistantId: string, enabled: boolean): Promise<void> {
    const { binary } = this.tenant();
    const assistantBinary = uuidToBinary(assistantId);
    const rows = await this.run(
      'SELECT `id` FROM `assistants` WHERE `id`=? AND `tenant_id`=? AND `deleted_at` IS NULL',
      [assistantBinary, binary],
    );
    if (!rows[0]) throw new NotFoundException('Assistant not found.');
    const toolId = await this.toolId(undefined, name);
    await this.database.query(
      `INSERT INTO \`assistant_tools\` (\`tenant_id\`,\`assistant_id\`,\`tool_id\`,\`enabled\`)
       VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE \`enabled\`=VALUES(\`enabled\`)`,
      [binary, assistantBinary, toolId, enabled ? 1 : 0],
    );
  }

  async enableWebsiteTools(
    manager: EntityManager,
    assistantId: string,
    actorId: string,
    names: readonly string[],
  ): Promise<void> {
    const { binary } = this.tenant();
    const assistantBinary = uuidToBinary(assistantId);
    const assistant = await this.run(
      'SELECT 1 FROM `assistants` WHERE `id`=? AND `tenant_id`=? AND `status`=\'active\' AND `deleted_at` IS NULL',
      [assistantBinary, binary],
      manager,
    );
    if (!assistant[0]) throw new NotFoundException('Assistant not found.');
    const actorBinary = uuidToBinary(actorId);
    for (const name of names) {
      const toolId = await this.toolId(manager, name);
      await manager.query(
        `INSERT INTO \`tenant_tools\` (\`id\`,\`tenant_id\`,\`tool_id\`,\`enabled\`,\`extra_permissions\`,\`max_calls_per_conversation\`,\`updated_by\`)
         VALUES (?,?,?,1,NULL,NULL,?) ON DUPLICATE KEY UPDATE \`enabled\`=1,\`updated_by\`=VALUES(\`updated_by\`)`,
        [uuidToBinary(newUuidv7()), binary, toolId, actorBinary],
      );
      await manager.query(
        `INSERT INTO \`assistant_tools\` (\`tenant_id\`,\`assistant_id\`,\`tool_id\`,\`enabled\`)
         VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE \`enabled\`=1`,
        [binary, assistantBinary, toolId],
      );
    }
  }

  async secretStatus(name: string): Promise<{ configured: boolean; lastRotatedAt: Date | null; expiresAt: Date | null }> {
    const { binary } = this.tenant();
    const rows = await this.run(
      `SELECT \`last_rotated_at\`,\`expires_at\`,\`revoked_at\` FROM \`tool_secrets\`
       WHERE \`tenant_id\`=? AND \`key_label\`=?`,
      [binary, `${name}:credential`],
    );
    const row = rows[0];
    return {
      configured: Boolean(row && !row.revoked_at && (!row.expires_at || new Date(row.expires_at as string).getTime() > Date.now())),
      lastRotatedAt: row?.last_rotated_at ? new Date(row.last_rotated_at as string) : null,
      expiresAt: row?.expires_at ? new Date(row.expires_at as string) : null,
    };
  }

  async setSecret(name: string, actorId: string, secret: string, expiresAt: string | null): Promise<void> {
    if (!this.secretCipher) throw new ServiceUnavailableException('Tool secret storage is not configured.');
    const { id: tenantId, binary } = this.tenant();
    const label = `${name}:credential`;
    const encrypted = this.secretCipher.encrypt(secret, secretAad(tenantId, name, label, this.secretCipher.currentVersion()));
    await this.database.query(
      `INSERT INTO \`tool_secrets\` (\`id\`,\`tenant_id\`,\`key_label\`,\`key_version\`,\`ciphertext\`,\`iv\`,\`auth_tag\`,
        \`last_rotated_at\`,\`expires_at\`,\`revoked_at\`,\`created_by\`)
       VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3),?,NULL,?)
       ON DUPLICATE KEY UPDATE \`key_version\`=VALUES(\`key_version\`),\`ciphertext\`=VALUES(\`ciphertext\`),
        \`iv\`=VALUES(\`iv\`),\`auth_tag\`=VALUES(\`auth_tag\`),\`last_rotated_at\`=UTC_TIMESTAMP(3),
        \`expires_at\`=VALUES(\`expires_at\`),\`revoked_at\`=NULL,\`created_by\`=VALUES(\`created_by\`)`,
      [
        uuidToBinary(newUuidv7()), binary, label, encrypted.keyVersion, encrypted.ciphertext,
        encrypted.iv, encrypted.authTag, expiresAt, uuidToBinary(actorId),
      ],
    );
  }

  async revokeSecret(name: string): Promise<void> {
    const { binary } = this.tenant();
    await this.database.query(
      'UPDATE `tool_secrets` SET `revoked_at`=UTC_TIMESTAMP(3) WHERE `tenant_id`=? AND `key_label`=? AND `revoked_at` IS NULL',
      [binary, `${name}:credential`],
    );
  }

  async nameById(id: string): Promise<string> {
    if (!/^[1-9]\d{0,19}$/.test(id)) throw new NotFoundException('Tool not found.');
    const rows = await this.run('SELECT `name` FROM `tools` WHERE `id`=? AND `is_active`=1', [id]);
    if (!rows[0]) throw new NotFoundException('Tool not found.');
    return String(rows[0].name);
  }

  private async toolId(manager: EntityManager | undefined, name: string): Promise<unknown> {
    const rows = await this.run('SELECT `id` FROM `tools` WHERE `name`=? AND `is_active`=1', [name], manager);
    if (!rows[0]) throw new NotFoundException('Tool not found.');
    return rows[0].id;
  }
}

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new ServiceUnavailableException('Stored tool settings are invalid.');
  }
  return parsed;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceUnavailableException('Stored tool configuration is invalid.');
  }
  return parsed as Record<string, unknown>;
}

export function secretAad(tenantId: string, toolName: string, label: string, version: number): string {
  return `tool-secret:${tenantId}:${toolName}:${label}:${version}`;
}
