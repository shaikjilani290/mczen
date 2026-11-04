import * as mysql from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MysqlConfig } from '../../src/database/mysql-config';
import { ALL_MIGRATIONS } from '../../src/database/migrations';
import { newUuidv7, uuidToBinary } from '../../src/common/ids/uuid';
import { AuditService } from '../../src/audit/audit.service';

/**
 * Opt-in Phase 6K integration test against a REAL, ISOLATED MySQL 8.4 server (migrations 1-12).
 * Credentials come only from local environment variables and are never printed:
 *   RUN_DB_TESTS=1 DB_HOST DB_PORT DB_USERNAME (or DB_USER) DB_PASSWORD DB_DATABASE (or DB_NAME)
 * Identity gate (the suite aborts before any DDL if any check fails):
 *   - host is loopback, never a remote/VPS address;
 *   - server reports 8.4.x and is not MariaDB (so XAMPP is rejected);
 *   - the server's own port equals DB_PORT;
 *   - DB_DATABASE is named like a dedicated test database (mczen_test*, mczen_6k*, *_test).
 * Only a fresh throwaway schema `mczen_6k_<ts>_<rand>` is created and dropped; DB_DATABASE is never modified.
 */
// DB_USERNAME/DB_DATABASE are the canonical names (MysqlConfig.fromEnv);
// DB_USER/DB_NAME are accepted as aliases, matching the other DB suites.
const dbUsername = process.env.DB_USERNAME ?? process.env.DB_USER;
const dbDatabase = process.env.DB_DATABASE ?? process.env.DB_NAME;
const RUN =
  process.env.RUN_DB_TESTS === '1' &&
  typeof process.env.DB_HOST === 'string' &&
  typeof process.env.DB_PORT === 'string' &&
  typeof process.env.DB_PASSWORD === 'string' &&
  typeof dbUsername === 'string' &&
  typeof dbDatabase === 'string';
const describeDb = RUN ? describe : describe.skip;
jest.setTimeout(180_000);

describeDb('Phase 6K migrations 8-12 (real isolated MySQL 8.4)', () => {
  const database = `mczen_6k_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  let admin: Connection;
  let source: DataSource;
  let created = false;
  const tenantA = newUuidv7();
  const tenantB = newUuidv7();

  const rows = async (sql: string, params: unknown[] = []) => (await source.query(sql, params)) as Array<Record<string, unknown>>;

  beforeAll(async () => {
    const host = process.env.DB_HOST as string;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Refusing to run: DB_HOST must be loopback.');
    if (!/^(mczen_test|mczen_6k)|_test$/i.test(dbDatabase as string)) {
      throw new Error('Refusing to run: DB_DATABASE is not named like a dedicated test database.');
    }
    admin = await mysql.createConnection({ host, port: Number(process.env.DB_PORT), user: dbUsername, password: process.env.DB_PASSWORD });
    const [[identity]] = await admin.query('SELECT VERSION() AS version, @@version_comment AS comment, @@port AS port, @@hostname AS host') as unknown as [[Record<string, string | number>]];
    if (!/^8\.4\./.test(String(identity.version)) || /mariadb/i.test(`${identity.version} ${identity.comment}`)) {
      throw new Error('Refusing to run: server is not MySQL 8.4 (MariaDB/XAMPP and other versions are rejected).');
    }
    if (Number(identity.port) !== Number(process.env.DB_PORT)) throw new Error('Refusing to run: server port does not match DB_PORT.');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    created = true;
    source = new DataSource({
      ...MysqlConfig.fromEnv({ ...process.env, DB_DATABASE: database, DB_NAME: database }).toTypeormOptions(ALL_MIGRATIONS),
      entities: [], logging: false, migrationsTransactionMode: 'each', synchronize: false,
    });
    await source.initialize();
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin) {
      if (created && /^mczen_6k_[a-z0-9]+_[0-9a-f]{6}$/.test(database)) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });

  it('applies all 12 migrations once, records them in order, and is idempotent', async () => {
    const applied = await source.runMigrations();
    expect(applied).toHaveLength(ALL_MIGRATIONS.length);
    expect(ALL_MIGRATIONS).toHaveLength(12);
    expect(await source.runMigrations()).toHaveLength(0);
    expect(await source.showMigrations()).toBe(false);
    const ledger = await rows('SELECT `name` FROM `migrations` ORDER BY `id`');
    expect(ledger).toHaveLength(12);
    expect(String(ledger[11].name)).toContain('AuditEvents');
  });

  it('creates the Phase 6 tables with utf8mb4_0900_ai_ci and InnoDB', async () => {
    const tables = await rows('SELECT TABLE_NAME AS t, ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [database]);
    const names = tables.map((t) => String(t.t));
    for (const name of ['tenants', 'users', 'widget_settings', 'audit_events', 'conversations', 'voice_sessions']) expect(names).toContain(name);
    expect(names.some((n) => n.startsWith('tool'))).toBe(true);
    for (const table of tables) {
      if (String(table.t) === 'migrations') continue;
      expect(table.e).toBe('InnoDB');
      expect(table.c).toBe('utf8mb4_0900_ai_ci');
    }
  });

  it('has no orphaned foreign keys and a FULLTEXT index for knowledge search', async () => {
    const fks = await rows('SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS c FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? AND CONSTRAINT_TYPE=\'FOREIGN KEY\'', [database]);
    expect(fks.length).toBeGreaterThan(5);
    // On a freshly migrated schema every FK-bearing table is empty except the
    // global RBAC catalogs seeded by migration 1740000000003: roles and
    // permissions carry no FKs, while role_permissions holds the grant matrix.
    const seededCatalogs = new Set(['role_permissions']);
    for (const fk of fks) {
      if (seededCatalogs.has(String(fk.t))) continue;
      const [check] = await rows(`SELECT COUNT(*) AS n FROM \`${String(fk.t)}\``);
      expect(Number(check.n)).toBe(0);
    }
    // Seed matrix across the six roles: 21+19+16+12+11+0 grants.
    const [grants] = await rows('SELECT COUNT(*) AS n FROM `role_permissions`');
    expect(Number(grants.n)).toBe(79);
    const ft = await rows('SELECT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND INDEX_TYPE=\'FULLTEXT\'', [database]);
    expect(ft.length).toBeGreaterThan(0);
  });

  it('allows anonymous (NULL user) voice sessions and widget conversations', async () => {
    const cols = await rows('SELECT TABLE_NAME AS t, IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND COLUMN_NAME=\'user_id\' AND TABLE_NAME IN (\'voice_sessions\',\'conversations\')', [database]);
    expect(cols).toHaveLength(2);
    for (const col of cols) expect(col.n).toBe('YES');
  });

  it('widget_settings: unique public key, tenant FK cascade', async () => {
    for (const [id, slug] of [[tenantA, 'a'], [tenantB, 'b']]) {
      await source.query('INSERT INTO `tenants` (`id`, `name`, `slug`) VALUES (?, ?, ?)', [uuidToBinary(id), `Tenant ${slug}`, `k6-${slug}-${randomBytes(2).toString('hex')}`]);
    }
    const insert = (tenant: string, key: string) => source.query('INSERT INTO `widget_settings` (`tenant_id`,`public_key`,`name`,`allowed_origins`) VALUES (?,?,?,JSON_ARRAY())', [uuidToBinary(tenant), key, 'W']);
    await insert(tenantA, 'wk_integration_a');
    await expect(insert(tenantB, 'wk_integration_a')).rejects.toThrow(/Duplicate/i);
    await insert(tenantB, 'wk_integration_b');
    await expect(insert(newUuidv7(), 'wk_integration_c')).rejects.toThrow(/foreign key/i);
    await source.query('DELETE FROM `tenants` WHERE `id`=?', [uuidToBinary(tenantB)]);
    expect(await rows('SELECT 1 FROM `widget_settings` WHERE `tenant_id`=?', [uuidToBinary(tenantB)])).toHaveLength(0);
  });

  it('audit_events: persists sanitised events, isolates tenants, survives tenant deletion, has indexes', async () => {
    const audit = new AuditService(source);
    await audit.record({ scope: 'tenant', tenantId: tenantA, actorType: 'user', actorId: newUuidv7(), action: 'widget.key.rotate', resourceType: 'widget_settings', metadata: { fields: 'publicKey', token: 'must-not-persist', apiKey: 'must-not-persist' } });
    await audit.record({ scope: 'tenant', tenantId: tenantB, actorType: 'user', action: 'tool.secret.set', metadata: { fields: 'value' } });
    await audit.record({ scope: 'platform', tenantId: tenantA, actorType: 'platform_admin', action: 'platform.tenant.status', metadata: { status: 'suspended' } });
    expect(audit.failureCount).toBe(0);

    const a = await audit.list({ scope: 'tenant', tenantId: tenantA, limit: 50 });
    expect(a.items.map((e) => e.action)).toEqual(['widget.key.rotate']);
    expect(a.items[0].metadata).toEqual({ fields: 'publicKey' });
    expect(JSON.stringify(await rows('SELECT * FROM `audit_events`'))).not.toContain('must-not-persist');
    expect((await audit.list({ scope: 'tenant', tenantId: tenantB, limit: 50 })).items.map((e) => e.action)).toEqual(['tool.secret.set']);
    expect((await audit.list({ scope: 'platform', limit: 50 })).items.map((e) => e.action)).toEqual(['platform.tenant.status']);

    const fks = await rows('SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? AND TABLE_NAME=\'audit_events\' AND CONSTRAINT_TYPE=\'FOREIGN KEY\'', [database]);
    expect(fks).toHaveLength(0);
    const indexes = (await rows('SELECT DISTINCT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=\'audit_events\'', [database])).map((r) => String(r.i));
    expect(indexes).toEqual(expect.arrayContaining(['idx_audit_tenant_created', 'idx_audit_tenant_action_created', 'idx_audit_actor_created', 'idx_audit_resource', 'idx_audit_scope_created']));
  });

  it('rolls back migration 12 only, then reapplies it without other schema changes', async () => {
    const before = (await rows('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME<>\'audit_events\' ORDER BY 1', [database])).map((r) => r.t);
    await source.undoLastMigration();
    expect((await rows('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=\'audit_events\'', [database]))).toHaveLength(0);
    expect(await rows('SELECT 1 FROM `migrations`')).toHaveLength(11);
    expect(await source.runMigrations()).toHaveLength(1);
    const after = (await rows('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME<>\'audit_events\' ORDER BY 1', [database])).map((r) => r.t);
    expect(after).toEqual(before);
    expect(await rows('SELECT 1 FROM `migrations`')).toHaveLength(12);
  });
});
