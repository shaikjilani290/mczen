/* eslint-disable no-console */
import * as mysql from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import { DataSource, MigrationInterface, QueryRunner } from 'typeorm';
import { MysqlConfig } from '../../src/database/mysql-config';
import { ALL_MIGRATIONS } from '../../src/database/migrations';
import { uuidToBinary, binaryToUuid, newUuidv7 } from '../../src/common/ids/uuid';

/**
 * Phase 6B INTEGRATION suite — runs against a REAL MySQL 8 only.
 *
 * Opt-in guard: jest runs these tests in a normal `npm test`, but they are
 * skipped unless BOTH conditions hold:
 *   1. a complete DB_* environment is present, and
 *   2. RUN_DB_TESTS=1 is exported.
 * The suite creates its own scratch database (root connection from the env),
 * everything via migrations, and drops the scratch databases afterwards.
 * No committed configuration ever points at these credentials.
 */

const REQUIRED_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const;
jest.setTimeout(30_000); // real DDL + 79 seed statements must never race the default 5s
const envReady = REQUIRED_KEYS.every((k) => typeof process.env[k] === 'string');
const RUN = envReady && process.env.RUN_DB_TESTS === '1';

const describeDb = RUN ? describe : describe.skip;
// Keep this accepted 6B rehearsal on its original three-migration baseline.
// Phase 6C has its own full-registry upgrade/revert/auth integration suite.
const FOUNDATION_MIGRATIONS = ALL_MIGRATIONS.slice(0, 3);

const STAMP = Date.now().toString(36);
const DB_MAIN = `mczen_it_${STAMP}`;
const DB_FAIL = `mczen_it_fail_${STAMP}`;

let admin: Connection;
let ds: DataSource;

async function adminQuery(sql: string): Promise<void> {
  await admin.query(sql);
}

/** A migration whose up() always fails — for the failure-handling test. */
class FailingMigration implements MigrationInterface {
  name = 'FailingMigration9999999999999';
  up(_qr: QueryRunner): Promise<void> {
    return Promise.reject(new Error('boom: intentional failure'));
  }
  down(): Promise<void> {
    return Promise.resolve();
  }
}

beforeAll(async () => {
  if (!RUN) return; // TypeScript narrowing helper: real guard is the describe.skip
  const base = {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD as string,
  };

  admin = await mysql.createConnection(base);
  await adminQuery(`DROP DATABASE IF EXISTS \`${DB_MAIN}\``);
  await adminQuery(
    `CREATE DATABASE \`${DB_MAIN}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await adminQuery(`DROP DATABASE IF EXISTS \`${DB_FAIL}\``);
  await adminQuery(
    `CREATE DATABASE \`${DB_FAIL}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );

  const config = MysqlConfig.fromEnv({
    ...process.env,
    DB_NAME: DB_MAIN,
  } as unknown as Record<string, string>);
  ds = new DataSource({
    ...config.toTypeormOptions(FOUNDATION_MIGRATIONS),
    entities: [],
    logging: ['error'],
  });
  await ds.initialize();
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
  if (admin) {
    await adminQuery(`DROP DATABASE IF EXISTS \`${DB_MAIN}\``);
    await adminQuery(`DROP DATABASE IF EXISTS \`${DB_FAIL}\``);
    await admin.end();
  }
});

describeDb('MySQL foundation — real database (Phase 6B)', () => {
  it('fresh initialization runs all three migrations in order', async () => {
    const applied = await ds.runMigrations();
    expect(applied.map((m) => m.name)).toEqual(
      FOUNDATION_MIGRATIONS.map((m) => m.name),
    );
    const rows = (await ds.query('SELECT `name` FROM `migrations` ORDER BY `id`')) as Array<{
      name: string;
    }>;
    expect(rows.map((r) => r.name)).toEqual(FOUNDATION_MIGRATIONS.map((m) => m.name));
  });

  it('re-running migrations is a no-op (duplicate-migration prevention)', async () => {
    const secondRun = await ds.runMigrations();
    expect(secondRun).toHaveLength(0);
    const rows = (await ds.query('SELECT COUNT(*) AS n FROM `migrations`')) as Array<{ n: number }>;
    expect(Number(rows[0].n)).toBe(3);
  });

  it('created all Domain A + Domain B tables (information_schema)', async () => {
    const rows = (await ds.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [DB_MAIN],
    )) as Array<{ TABLE_NAME: string }>;
    const names = rows.map((r) => r.TABLE_NAME);
    for (const table of [
      'tenants', 'tenant_settings', 'tenant_domains', 'tenant_api_keys',
      'users', 'roles', 'permissions', 'role_permissions', 'tenant_users',
      'user_sessions', 'refresh_tokens', 'migrations',
    ]) {
      expect(names).toContain(table);
    }
    expect(names).toHaveLength(12); // 11 domain tables + migrations bookkeeping
  });

  it('seeded the global catalog idempotently and exactly once', async () => {
    const roles = (await ds.query('SELECT `key`, `is_platform` FROM `roles` ORDER BY `key`')) as Array<{
      key: string;
      is_platform: number;
    }>;
    expect(roles.map((r) => r.key)).toEqual([
      'platform:admin', 'tenant:admin', 'tenant:editor', 'tenant:member',
      'tenant:owner', 'tenant:viewer',
    ]);
    const platform = roles.find((r) => r.key === 'platform:admin')!;
    expect(Number(platform.is_platform)).toBe(1);

    const counts = (await ds.query(
      `SELECT
         (SELECT COUNT(*) FROM \`permissions\`) AS perms,
         (SELECT COUNT(*) FROM \`role_permissions\`) AS grants`,
    )) as Array<{ perms: number; grants: number }>;
    expect(Number(counts[0].perms)).toBe(21);

    // Matrix spot-checks against the seeded data (not just code):
    const grants = (await ds.query(
      `SELECT r.\`key\` AS role, COUNT(*) AS n FROM \`role_permissions\` rp
         JOIN \`roles\` r ON r.\`id\` = rp.\`role_id\`
        GROUP BY r.\`key\` ORDER BY r.\`key\``,
    )) as Array<{ role: string; n: number }>;
    const byRole = new Map(grants.map((g) => [g.role, Number(g.n)]));
    expect(byRole.get('tenant:owner')).toBe(21);
    expect(byRole.get('tenant:admin')).toBe(19);
    expect(byRole.get('tenant:editor')).toBe(16);
    expect(byRole.get('tenant:member')).toBe(12);
    expect(byRole.get('tenant:viewer')).toBe(11);
    expect(byRole.has('platform:admin')).toBe(false); // zero grants

    const adminPerms = (await ds.query(
      `SELECT p.\`key\` FROM \`role_permissions\` rp
         JOIN \`roles\` r ON r.\`id\` = rp.\`role_id\`
         JOIN \`permissions\` p ON p.\`id\` = rp.\`permission_id\`
        WHERE r.\`key\` = 'tenant:admin' AND p.\`key\` IN ('api_keys:manage','billing:manage')`,
    )) as Array<{ key: string }>;
    expect(adminPerms).toHaveLength(0); // admin excluded from both
  });

  it('stores BINARY(16) UUIDv7 and round-trips it (read back identical)', async () => {
    const id = newUuidv7();
    const slug = `tenant-${STAMP}`;
    await ds.query(
      `INSERT INTO \`tenants\` (\`id\`, \`name\`, \`slug\`) VALUES (?, ?, ?)`,
      [uuidToBinary(id), 'Integration Tenant', slug],
    );
    const rows = (await ds.query('SELECT `id` FROM `tenants` WHERE `slug` = ?', [slug])) as Array<{
      id: Buffer;
    }>;
    expect(rows).toHaveLength(1);
    expect(binaryToUuid(rows[0].id)).toBe(id);
    expect(rows[0].id.length).toBe(16);
  });

  it('enforces foreign keys (1452 on orphan tenant_users insert)', async () => {
    const tenantBinary = uuidToBinary(newUuidv7());
    const userBinary = uuidToBinary(newUuidv7());
    // valid tenant + user first
    await ds.query(
      `INSERT INTO \`tenants\` (\`id\`, \`name\`, \`slug\`) VALUES (?, 'FK Tenant', ?)`,
      [tenantBinary, `fk-${STAMP}`],
    );
    await ds.query(
      `INSERT INTO \`users\` (\`id\`, \`email\`, \`password_hash\`) VALUES (?, ?, 'x')`,
      [userBinary, `fk-${STAMP}@example.com`],
    );
    // orphan membership must be rejected
    await expect(
      ds.query(
        `INSERT INTO \`tenant_users\` (\`id\`, \`tenant_id\`, \`user_id\`, \`role_id\`)
         VALUES (?, ?, ?, 1)`,
        [uuidToBinary(newUuidv7()), uuidToBinary(newUuidv7()), userBinary, 1],
      ),
    ).rejects.toMatchObject({ errno: 1452, code: 'ER_NO_REFERENCED_ROW_2' });
    // valid membership succeeds (role_id=1 exists from the seed catalog)
    await ds.query(
      `INSERT INTO \`tenant_users\` (\`id\`, \`tenant_id\`, \`user_id\`, \`role_id\`, \`status\`, \`joined_at\`)
       VALUES (?, ?, ?, 1, 'active', UTC_TIMESTAMP(3))`,
      [uuidToBinary(newUuidv7()), tenantBinary, userBinary],
    );
  });

  it('frees soft-deleted tenant domains through the generated is_live column', async () => {
    const tenantBinary = uuidToBinary(newUuidv7());
    await ds.query(
      `INSERT INTO \`tenants\` (\`id\`, \`name\`, \`slug\`) VALUES (?, 'Domain Tenant', ?)`,
      [tenantBinary, `dom-${STAMP}`],
    );
    const domain = `example.com`;
    await ds.query(
      `INSERT INTO \`tenant_domains\` (\`id\`, \`tenant_id\`, \`domain\`) VALUES (?, ?, ?)`,
      [uuidToBinary(newUuidv7()), tenantBinary, domain],
    );
    // duplicate live row collides on the partial unique key
    await expect(
      ds.query(
        `INSERT INTO \`tenant_domains\` (\`id\`, \`tenant_id\`, \`domain\`) VALUES (?, ?, ?)`,
        [uuidToBinary(newUuidv7()), tenantBinary, domain],
      ),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    // soft delete frees the pair…
    await ds.query(
      `UPDATE \`tenant_domains\` SET \`deleted_at\` = UTC_TIMESTAMP(3) WHERE \`tenant_id\` = ?`,
      [tenantBinary],
    );
    await ds.query(
      `INSERT INTO \`tenant_domains\` (\`id\`, \`tenant_id\`, \`domain\`) VALUES (?, ?, ?)`,
      [uuidToBinary(newUuidv7()), tenantBinary, domain],
    );
    const rows = (await ds.query(
      'SELECT `is_live`, `deleted_at` FROM `tenant_domains` ORDER BY `deleted_at` DESC LIMIT 1',
    )) as Array<{ is_live: number | null; deleted_at: string | null }>;
    expect(rows[0].is_live).toBeNull(); // generated column: NULL once deleted
  });

  it('keeps DATETIME(3) UTC determinism over the Z timezone connection', async () => {
    await ds.query(
      `INSERT INTO \`tenants\` (\`id\`, \`name\`, \`slug\`, \`created_at\`)
       VALUES (?, 'Time Tenant', ?, ?)`,
      [uuidToBinary(newUuidv7()), `ts-${STAMP}`, '2026-01-02 03:04:05.678'],
    );
    const rows = (await ds.query(
      'SELECT `created_at` FROM `tenants` WHERE `slug` = ?',
      [`ts-${STAMP}`],
    )) as Array<{ created_at: Date }>;
    expect(new Date(rows[0].created_at).toISOString()).toBe('2026-01-02T03:04:05.678Z');
  });

  it('cascade-revokes refresh token families with their session (§6.2)', async () => {
    const tenantBinary = uuidToBinary(newUuidv7());
    const userBinary = uuidToBinary(newUuidv7());
    const sessionId = uuidToBinary(newUuidv7());
    const tokenId = uuidToBinary(newUuidv7());
    await ds.query(
      `INSERT INTO \`tenants\` (\`id\`, \`name\`, \`slug\`) VALUES (?, 'Sess Tenant', ?)`,
      [tenantBinary, `sess-${STAMP}`],
    );
    await ds.query(
      `INSERT INTO \`users\` (\`id\`, \`email\`, \`password_hash\`) VALUES (?, ?, 'x')`,
      [userBinary, `sess-${STAMP}@example.com`],
    );
    await ds.query(
      `INSERT INTO \`user_sessions\` (\`id\`, \`user_id\`, \`expires_at\`) VALUES (?, ?, UTC_TIMESTAMP(3) + INTERVAL 1 DAY)`,
      [sessionId, userBinary],
    );
    await ds.query(
      `INSERT INTO \`refresh_tokens\` (\`id\`, \`user_id\`, \`session_id\`, \`token_hash\`, \`family_id\`, \`expires_at\`)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL 1 DAY)`,
      [tokenId, userBinary, sessionId, `hash-${STAMP}`, uuidToBinary(newUuidv7())],
    );
    // Revoking the session removes the token family unconditionally:
    await ds.query('DELETE FROM `user_sessions` WHERE `id` = ?', [sessionId]);
    const left = (await ds.query(
      'SELECT COUNT(*) AS n FROM `refresh_tokens` WHERE `session_id` = ?',
      [sessionId],
    )) as Array<{ n: number }>;
    expect(Number(left[0].n)).toBe(0);
  });

  it('reverts the seed migration and re-runs it cleanly (rollback path)', async () => {
    // The catalog down() is data-only but roles are referenced by tenant_users
    // (fk_tenant_users_roles RESTRICT) — referencing data must be removed
    // first, which is exactly what the RESTRICT couple is documented to do.
    await ds.query('DELETE FROM `tenant_users`');
    await ds.undoLastMigration(); // only the seed migration is data — safe to revert
    const after = (await ds.query(
      `SELECT
         (SELECT COUNT(*) FROM \`roles\`) AS r,
         (SELECT COUNT(*) FROM \`permissions\`) AS p,
         (SELECT COUNT(*) FROM \`role_permissions\`) AS g,
         (SELECT COUNT(*) FROM \`migrations\`) AS m`,
    )) as Array<{ r: number; p: number; g: number; m: number }>;
    expect(Number(after[0].r)).toBe(0);
    expect(Number(after[0].p)).toBe(0);
    expect(Number(after[0].g)).toBe(0);
    expect(Number(after[0].m)).toBe(2);

    const reapplied = await ds.runMigrations();
    const seedName = FOUNDATION_MIGRATIONS.map((m) => m.name)[FOUNDATION_MIGRATIONS.length - 1];
    expect(reapplied.map((m) => m.name)).toEqual([seedName]);
    const again = (await ds.query(
      `SELECT
         (SELECT COUNT(*) FROM \`roles\`) AS r,
         (SELECT COUNT(*) FROM \`migrations\`) AS m`,
    )) as Array<{ r: number; m: number }>;
    expect(Number(again[0].r)).toBe(6);
    expect(Number(again[0].m)).toBe(3);
  });

  it('propagates migration failures and records only completed migrations', async () => {
    const failConfig = MysqlConfig.fromEnv({
      ...process.env,
      DB_NAME: DB_FAIL,
    } as unknown as Record<string, string>);
    const failDs = new DataSource({
      ...failConfig.toTypeormOptions([
        ...ALL_MIGRATIONS.slice(0, 1),
        FailingMigration,
      ]),
      entities: [],
      logging: ['error'],
    });
    await failDs.initialize();
    try {
      await expect(failDs.runMigrations()).rejects.toThrow('boom: intentional failure');
      // only the migration that completed is recorded
      const rows = (await failDs.query(
        'SELECT `name` FROM `migrations` ORDER BY `id`',
      )) as Array<{ name: string }>;
      expect(rows.map((r) => r.name)).toEqual([ALL_MIGRATIONS.map((m) => m.name)[0]]);
      const tables = (await failDs.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE='BASE TABLE'`,
        [DB_FAIL],
      )) as Array<{ TABLE_NAME: string }>;
      const names = tables.map((t) => t.TABLE_NAME);
      expect(names).toContain('tenants'); // the completed migration's tables remain
      expect(names).not.toContain('users'); // the failed migration produced nothing
      // The migrations ledger records the completed migration's name only:
      const ledger = (await failDs.query(
        'SELECT `name` FROM `migrations`',
      )) as Array<{ name: string }>;
      expect(ledger.map((r) => r.name)).not.toContain('boom: intentional failure');
      expect(ledger.map((r) => r.name).length).toBe(1);
    } finally {
      await failDs.destroy();
    }
  });
});

export {};
