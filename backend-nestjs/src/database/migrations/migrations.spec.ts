import { QueryRunner } from 'typeorm';
import { ALL_MIGRATIONS } from './index';
import { DomainATenants1740000000001 } from './1740000000001-DomainATenants';
import { DomainBAuth1740000000002 } from './1740000000002-DomainBAuth';
import { SeedGlobalCatalogs1740000000003 } from './1740000000003-SeedGlobalCatalogs';
import { ToolConfiguration1740000000008 } from './1740000000008-ToolConfiguration';
import { ConversationPersistence1740000000009 } from './1740000000009-ConversationPersistence';

/** Captures every SQL statement/params pair without touching a database. */
function fakeRunner(): { runner: QueryRunner; captured: Array<{ sql: string; params?: unknown[] }> } {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const runner = {
    query: async (
      sql: string,
      params?: unknown[],
    ): Promise<unknown> => {
      captured.push({ sql, params });
      return [];
    },
  } as unknown as QueryRunner;
  return { runner, captured };
}

const INTERNALS = SeedGlobalCatalogs1740000000003 as unknown as {
  ROLES: ReadonlyArray<[string, string, string, number]>;
  PERMISSIONS: ReadonlyArray<[string, string, string]>;
};

describe('Migration set static structure (Phase 6B, DB-free)', () => {
  it('registers exactly the §12.4 Phase-6B subset in dependency order', () => {
    // Preserve the accepted 6B subset; new refinements are appended, not folded into it.
    expect(ALL_MIGRATIONS.slice(0, 3)).toEqual([
      DomainATenants1740000000001, // Domain A (tenants) first…
      DomainBAuth1740000000002, // …then Domain B (needs tenants + users)…
      SeedGlobalCatalogs1740000000003, // …then data seeds (needs catalogs)
    ]);
    const names = ALL_MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length); // uniqueness — no silent re-runs
    expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
  });

  it('Domain A creates the four tenant tables with pinned engine/charset', async () => {
    const { runner, captured } = fakeRunner();
    await new DomainATenants1740000000001().up(runner);
    const sql = captured.map((s) => s.sql).join('\n');
    for (const table of ['tenants', 'tenant_settings', 'tenant_domains', 'tenant_api_keys']) {
      expect(sql).toContain(`CREATE TABLE \`${table}\``);
    }
    // Environment-proof invariants: InnoDB + utf8mb4 on every table.
    expect((sql.match(/ENGINE=InnoDB/g) ?? []).length).toBe(4);
    expect(sql).toContain('utf8mb4_0900_ai_ci');
    // Partial-uniqueness convention via the generated is_live column.
    expect(sql).toContain('is_live` TINYINT(1) GENERATED ALWAYS AS');
    expect(sql).toContain('uk_tenant_domains_tenant_domain_live');
    // Down reverses all four tables.
    const { runner: dRunner, captured: dSail } = fakeRunner();
    await new DomainATenants1740000000001().down(dRunner);
    const downSql = dSail.map((s) => s.sql).join('\n');
    for (const table of ['tenant_api_keys', 'tenant_domains', 'tenant_settings', 'tenants']) {
      expect(downSql).toContain(`DROP TABLE IF EXISTS \`${table}\``);
    }
  });

  it('Domain B creates the seven auth tables and re-links the deferred FK', async () => {
    const { runner, captured } = fakeRunner();
    await new DomainBAuth1740000000002().up(runner);
    const sql = captured.map((s) => s.sql).join('\n');
    for (const table of [
      'users',
      'roles',
      'permissions',
      'role_permissions',
      'tenant_users',
      'user_sessions',
      'refresh_tokens',
    ]) {
      expect(sql).toContain(`CREATE TABLE \`${table}\``);
    }
    expect((sql.match(/ENGINE=InnoDB/g) ?? []).length).toBe(7);
    // Deferred FK from Domain A: tenant_api_keys.created_by → users.
    expect(sql).toContain('ADD CONSTRAINT `fk_tenant_api_keys_users`');
    // Session revocation removes token families unconditionally (§6.2).
    expect(
      /fk_refresh_tokens_sessions` FOREIGN KEY \(`session_id`\)[\s\S]*?ON DELETE CASCADE/.test(sql),
    ).toBe(true);
    const dFake = fakeRunner();
    await new DomainBAuth1740000000002().down(dFake.runner);
    expect(dFake.captured[0].sql).toContain('DROP FOREIGN KEY `fk_tenant_api_keys_users`');
    expect(dFake.captured.map((s) => s.sql).join('\n')).toContain('DROP TABLE IF EXISTS `users`');
  });

  it('seed migration is idempotent (INSERT IGNORE) and matches the approved matrix', async () => {
    // 6 roles incl. the reserved platform:admin; 21 permissions per §9.
    expect(INTERNALS.ROLES).toHaveLength(6);
    expect(INTERNALS.PERMISSIONS).toHaveLength(21);
    expect(
      INTERNALS.ROLES.map(([key]) => key).join(','),
    ).toBe('tenant:owner,tenant:admin,tenant:editor,tenant:member,tenant:viewer,platform:admin');

    const { runner, captured } = fakeRunner();
    await new SeedGlobalCatalogs1740000000003().up(runner);
    const sql = captured.map((s) => s.sql).join('\n');
    expect((sql.match(/INSERT IGNORE INTO `roles`/g) ?? []).length).toBe(6);
    expect((sql.match(/INSERT IGNORE INTO `permissions`/g) ?? []).length).toBe(21);

    // Role→permission matrix, read back from the executed grants:
    const grants = captured
      .filter((s) => s.sql.includes('role_permissions') && (s.params?.length ?? 0) === 2)
      .map((s) => [s.params![0] as string, s.params![1] as string] as const);
    const permKeys = INTERNALS.PERMISSIONS.map(([k]) => k);
    const countFor = (role: string) => grants.filter(([r]) => r === role).length;
    expect(countFor('tenant:owner')).toBe(21); // owner: full control
    const adminKeys = grants.filter(([r]) => r === 'tenant:admin').map(([, p]) => p);
    expect(adminKeys.length).toBe(19); // everything except…
    expect(adminKeys).not.toContain('api_keys:manage');
    expect(adminKeys).not.toContain('billing:manage');
    expect(countFor('tenant:editor')).toBe(16);
    expect(countFor('tenant:member')).toBe(12);
    expect(countFor('tenant:viewer')).toBe(11);
    expect(countFor('platform:admin')).toBe(0); // reserved role grants nothing
    // owner must be a superset of every other tenant role
    for (const role of ['tenant:admin', 'tenant:editor', 'tenant:member', 'tenant:viewer']) {
      for (const p of grants.filter(([r]) => r === role).map(([, x]) => x)) {
        expect(permKeys).toContain(p);
      }
    }
  });

  it('seed down() clears data-only catalogs (no DDL)', async () => {
    const { runner, captured } = fakeRunner();
    await new SeedGlobalCatalogs1740000000003().down(runner);
    const sql = captured.map((s) => s.sql).join('\n');
    expect(sql).toContain('DELETE FROM `role_permissions`');
    expect(sql).toContain('DELETE FROM `roles`');
    expect(sql).toContain('DELETE FROM `permissions`');
    expect(sql).not.toContain('DROP');
  });

  it('registers Domain E after migrations 1-7 and creates isolated tool tables', async () => {
    const names = ALL_MIGRATIONS.map((migration) => migration.name);
    expect(names.filter((name) => name === 'ToolConfiguration1740000000008')).toHaveLength(1);
    expect(names.indexOf('ToolConfiguration1740000000008')).toBe(names.indexOf('KnowledgeManagement1740000000007') + 1);
    const up = fakeRunner();
    await new ToolConfiguration1740000000008().up(up.runner);
    const sql = up.captured.map((entry) => entry.sql).join('\n');
    for (const table of ['tools', 'tenant_tools', 'assistant_tools', 'tool_permissions', 'tool_configurations', 'tool_secrets', 'tool_execution_logs']) {
      expect(sql).toContain(`CREATE TABLE \`${table}\``);
    }
    expect(sql).toContain('FOREIGN KEY (`assistant_id`, `tenant_id`)');
    expect(sql).toContain('utf8mb4_0900_ai_ci');
    const down = fakeRunner();
    await new ToolConfiguration1740000000008().down(down.runner);
    expect(down.captured.map((entry) => entry.sql)).toEqual([
      'DROP TABLE IF EXISTS `tool_execution_logs`',
      'DROP TABLE IF EXISTS `tool_secrets`',
      'DROP TABLE IF EXISTS `tool_configurations`',
      'DROP TABLE IF EXISTS `tool_permissions`',
      'DROP TABLE IF EXISTS `assistant_tools`',
      'DROP TABLE IF EXISTS `tenant_tools`',
      'DROP TABLE IF EXISTS `tools`',
    ]);
  });

  it('registers Phase 6G exactly once after migration 8 and creates additive tenant-scoped schema', async () => {
    const names = ALL_MIGRATIONS.map((migration) => migration.name);
    expect(names.filter((name) => name === 'ConversationPersistence1740000000009')).toHaveLength(1);
    expect(names.indexOf('ConversationPersistence1740000000009'))
      .toBe(names.indexOf('ToolConfiguration1740000000008') + 1);

    const up = fakeRunner();
    await new ConversationPersistence1740000000009().up(up.runner);
    const sql = up.captured.map((entry) => entry.sql).join('\n');
    for (const table of [
      'conversations', 'conversation_messages', 'message_tool_calls', 'conversation_feedback',
    ]) {
      expect(sql).toContain(`CREATE TABLE \`${table}\``);
    }
    expect(sql).toContain('FOREIGN KEY (`assistant_id`,`tenant_id`)');
    expect(sql).toContain('FOREIGN KEY (`conversation_id`,`tenant_id`)');
    expect(sql).toContain('ADD COLUMN `assistant_id`');
    expect(sql).toContain('arguments_summary');
    expect(sql).toContain('result_summary');
    expect(sql).toContain('utf8mb4_0900_ai_ci');
    expect(sql).not.toMatch(/\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);

    const down = fakeRunner();
    await new ConversationPersistence1740000000009().down(down.runner);
    expect(down.captured[0].sql).toContain('DROP COLUMN `assistant_id`');
    expect(down.captured.slice(1).map((entry) => entry.sql)).toEqual([
      'DROP TABLE IF EXISTS `conversation_feedback`',
      'DROP TABLE IF EXISTS `message_tool_calls`',
      'DROP TABLE IF EXISTS `conversation_messages`',
      'DROP TABLE IF EXISTS `conversations`',
    ]);
  });
});
