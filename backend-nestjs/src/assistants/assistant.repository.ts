import { ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { binaryToUuid, isUuidv7, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { TenantScopedRepository } from '../common/tenant/tenant-scoped.repository';
import type { Language, SecretKind } from './assistants.dto';

type Row = Record<string, unknown>;

export const DEFAULT_MAX_ASSISTANTS = 3;
const ALL_LANGUAGES: readonly Language[] = ['en', 'hi', 'te'];

export type AuditAction = 'create' | 'update' | 'instructions' | 'secret_set' | 'secret_clear';

/**
 * Raw, parameterized SQL repository (the project registers no TypeORM entities).
 * Every query takes the tenant from the verified context via currentTenantId();
 * no method accepts a tenant id from callers.
 */
@Injectable()
export class AssistantRepository extends TenantScopedRepository<ObjectLiteral> {
  constructor(@Optional() @InjectDataSource() private readonly source?: DataSource) {
    // No entity Repository exists for raw-SQL tables; only the tenant guard is inherited.
    super(undefined as unknown as Repository<ObjectLiteral>);
  }

  private get database(): DataSource {
    if (!this.source) throw new ServiceUnavailableException('Assistant configuration is unavailable.');
    return this.source;
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  private tenantBinary(): Buffer {
    return uuidToBinary(this.currentTenantId());
  }

  private run(manager: EntityManager | undefined, sql: string, params: unknown[]): Promise<Row[]> {
    return (manager ?? this.database).query(sql, params) as Promise<Row[]>;
  }

  /** Foreign or malformed ids are indistinguishable from missing ones. */
  assistantBinary(id: string): Buffer {
    if (!isUuidv7(id)) throw new NotFoundException('Assistant not found.');
    return uuidToBinary(id);
  }

  async list(): Promise<Row[]> {
    return this.run(undefined, 'SELECT * FROM `assistants` WHERE `tenant_id` = ? AND `deleted_at` IS NULL ORDER BY `created_at`, `id`', [this.tenantBinary()]);
  }

  async find(id: string, manager?: EntityManager, lock = false): Promise<Row> {
    const rows = await this.run(
      manager,
      `SELECT * FROM \`assistants\` WHERE \`id\` = ? AND \`tenant_id\` = ? AND \`deleted_at\` IS NULL${lock ? ' FOR UPDATE' : ''}`,
      [this.assistantBinary(id), this.tenantBinary()],
    );
    if (!rows[0]) throw new NotFoundException('Assistant not found.');
    return rows[0];
  }

  async voice(id: string, manager?: EntityManager): Promise<Row | undefined> {
    return (await this.run(manager, 'SELECT * FROM `assistant_voice_settings` WHERE `assistant_id` = ? AND `tenant_id` = ?', [this.assistantBinary(id), this.tenantBinary()]))[0];
  }

  async languages(id: string, manager?: EntityManager): Promise<Row[]> {
    return this.run(manager, 'SELECT `language_code`, `is_enabled`, `is_default` FROM `assistant_language_settings` WHERE `assistant_id` = ? AND `tenant_id` = ? ORDER BY `language_code`', [this.assistantBinary(id), this.tenantBinary()]);
  }

  async activeInstructions(id: string, manager?: EntityManager): Promise<Row | undefined> {
    return (await this.run(manager, 'SELECT `version`, `system_prompt`, `guardrail_notes`, `created_at` FROM `assistant_instructions` WHERE `assistant_id` = ? AND `tenant_id` = ? AND `is_active` = 1', [this.assistantBinary(id), this.tenantBinary()]))[0];
  }

  async instructionHistory(id: string): Promise<Row[]> {
    return this.run(undefined, 'SELECT `version`, `system_prompt`, `guardrail_notes`, `is_active`, `created_by`, `created_at` FROM `assistant_instructions` WHERE `assistant_id` = ? AND `tenant_id` = ? ORDER BY `version` DESC LIMIT 100', [this.assistantBinary(id), this.tenantBinary()]);
  }

  async configuredSecrets(id: string, manager?: EntityManager): Promise<SecretKind[]> {
    const rows = await this.run(manager, 'SELECT `kind` FROM `assistant_provider_secrets` WHERE `assistant_id` = ? AND `tenant_id` = ?', [this.assistantBinary(id), this.tenantBinary()]);
    return rows.map((r) => r.kind as SecretKind);
  }

  async audit(id: string): Promise<Row[]> {
    return this.run(undefined, 'SELECT `id`, `actor_user_id`, `action`, `config_version`, `changed_fields`, `created_at` FROM `assistant_config_audit` WHERE `assistant_id` = ? AND `tenant_id` = ? ORDER BY `id` DESC LIMIT 100', [this.assistantBinary(id), this.tenantBinary()]);
  }

  async maxAssistants(manager: EntityManager): Promise<number> {
    const rows = await this.run(manager, 'SELECT `max_assistants` FROM `tenant_settings` WHERE `tenant_id` = ? FOR UPDATE', [this.tenantBinary()]);
    return rows[0] ? Number(rows[0].max_assistants) : DEFAULT_MAX_ASSISTANTS;
  }

  async countActive(manager: EntityManager): Promise<number> {
    const rows = await this.run(manager, 'SELECT COUNT(*) AS `n` FROM `assistants` WHERE `tenant_id` = ? AND `deleted_at` IS NULL', [this.tenantBinary()]);
    return Number(rows[0]?.n ?? 0);
  }

  /** Inserts the assistant with default voice/language rows. Returns its id. */
  async insertAssistant(manager: EntityManager, input: { name: string; description: string | null; isDefault: boolean; actorId?: string }): Promise<string> {
    const id = newUuidv7();
    const tenant = this.tenantBinary();
    const idBin = uuidToBinary(id);
    try {
      await manager.query(
        'INSERT INTO `assistants` (`id`, `tenant_id`, `name`, `description`, `is_default`, `created_by`) VALUES (?, ?, ?, ?, ?, ?)',
        [idBin, tenant, input.name, input.description, input.isDefault ? 1 : 0, input.actorId ? uuidToBinary(input.actorId) : null],
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ConflictException('An assistant with this name already exists.');
      throw error;
    }
    await manager.query('INSERT INTO `assistant_voice_settings` (`assistant_id`, `tenant_id`, `updated_by`) VALUES (?, ?, ?)', [idBin, tenant, input.actorId ? uuidToBinary(input.actorId) : null]);
    await this.replaceLanguages(manager, id, [...ALL_LANGUAGES], 'en');
    return id;
  }

  async updateAssistantColumns(manager: EntityManager, id: string, columns: Record<string, unknown>): Promise<void> {
    const names = Object.keys(columns);
    // Column names come from the service's fixed mapping, never from request keys.
    const assignments = [...names.map((n) => `\`${n}\` = ?`), '`config_version` = `config_version` + 1'].join(', ');
    try {
      await manager.query(`UPDATE \`assistants\` SET ${assignments} WHERE \`id\` = ? AND \`tenant_id\` = ?`, [...names.map((n) => columns[n]), this.assistantBinary(id), this.tenantBinary()]);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ConflictException('An assistant with this name already exists.');
      throw error;
    }
  }

  async updateVoiceColumns(manager: EntityManager, id: string, columns: Record<string, unknown>, actorId?: string): Promise<void> {
    const names = Object.keys(columns);
    await manager.query(
      `UPDATE \`assistant_voice_settings\` SET ${[...names.map((n) => `\`${n}\` = ?`), '`updated_by` = ?'].join(', ')} WHERE \`assistant_id\` = ? AND \`tenant_id\` = ?`,
      [...names.map((n) => columns[n]), actorId ? uuidToBinary(actorId) : null, this.assistantBinary(id), this.tenantBinary()],
    );
  }

  async bumpVersion(manager: EntityManager, id: string): Promise<void> {
    await manager.query('UPDATE `assistants` SET `config_version` = `config_version` + 1 WHERE `id` = ? AND `tenant_id` = ?', [this.assistantBinary(id), this.tenantBinary()]);
  }

  async replaceLanguages(manager: EntityManager, id: string, enabled: Language[], defaultLanguage: Language): Promise<void> {
    const idBin = this.assistantBinary(id);
    const tenant = this.tenantBinary();
    await manager.query('DELETE FROM `assistant_language_settings` WHERE `assistant_id` = ? AND `tenant_id` = ?', [idBin, tenant]);
    for (const code of ALL_LANGUAGES) {
      await manager.query(
        'INSERT INTO `assistant_language_settings` (`assistant_id`, `tenant_id`, `language_code`, `is_enabled`, `is_default`) VALUES (?, ?, ?, ?, ?)',
        [idBin, tenant, code, enabled.includes(code) ? 1 : 0, code === defaultLanguage ? 1 : 0],
      );
    }
  }

  async insertInstructions(manager: EntityManager, id: string, systemPrompt: string, guardrailNotes: string | null, actorId?: string): Promise<number> {
    const idBin = this.assistantBinary(id);
    const tenant = this.tenantBinary();
    const rows = await manager.query('SELECT COALESCE(MAX(`version`), 0) AS `v` FROM `assistant_instructions` WHERE `assistant_id` = ? AND `tenant_id` = ?', [idBin, tenant]) as Row[];
    const version = Number(rows[0]?.v ?? 0) + 1;
    await manager.query('UPDATE `assistant_instructions` SET `is_active` = 0 WHERE `assistant_id` = ? AND `tenant_id` = ?', [idBin, tenant]);
    await manager.query(
      'INSERT INTO `assistant_instructions` (`assistant_id`, `tenant_id`, `version`, `system_prompt`, `guardrail_notes`, `is_active`, `created_by`) VALUES (?, ?, ?, ?, ?, 1, ?)',
      [idBin, tenant, version, systemPrompt, guardrailNotes, actorId ? uuidToBinary(actorId) : null],
    );
    return version;
  }

  async upsertSecret(manager: EntityManager, id: string, kind: SecretKind, ciphertext: string, actorId?: string): Promise<void> {
    await manager.query(
      'INSERT INTO `assistant_provider_secrets` (`assistant_id`, `tenant_id`, `kind`, `ciphertext`, `updated_by`) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `ciphertext` = VALUES(`ciphertext`), `updated_by` = VALUES(`updated_by`)',
      [this.assistantBinary(id), this.tenantBinary(), kind, ciphertext, actorId ? uuidToBinary(actorId) : null],
    );
  }

  async deleteSecret(manager: EntityManager, id: string, kind: SecretKind): Promise<void> {
    await manager.query('DELETE FROM `assistant_provider_secrets` WHERE `assistant_id` = ? AND `tenant_id` = ? AND `kind` = ?', [this.assistantBinary(id), this.tenantBinary(), kind]);
  }

  async writeAudit(manager: EntityManager, id: string, action: AuditAction, configVersion: number, fields: string[], actorId?: string): Promise<void> {
    await manager.query(
      'INSERT INTO `assistant_config_audit` (`assistant_id`, `tenant_id`, `actor_user_id`, `action`, `config_version`, `changed_fields`) VALUES (?, ?, ?, ?, ?, ?)',
      [this.assistantBinary(id), this.tenantBinary(), actorId ? uuidToBinary(actorId) : null, action, configVersion, fields.join(',').slice(0, 1000)],
    );
  }

  tenantIdForAad(): string {
    return this.currentTenantId();
  }

  toId(binary: unknown): string {
    return binaryToUuid(binary as Uint8Array);
  }
}
