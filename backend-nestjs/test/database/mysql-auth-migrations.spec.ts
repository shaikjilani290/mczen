import * as mysql from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MysqlConfig } from '../../src/database/mysql-config';
import { ALL_MIGRATIONS } from '../../src/database/migrations';
import { newUuidv7, uuidToBinary } from '../../src/common/ids/uuid';

const RUN = process.env.RUN_DB_TESTS === '1' && ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].every((key) => typeof process.env[key] === 'string');
const describeDb = RUN ? describe : describe.skip;
jest.setTimeout(60_000);

// Select migrations by their timestamp suffix, not by array position, so later
// phases appending to the registry cannot change what this 6C rehearsal covers.
const stamp = (migration: { name: string }): number => Number(/(\d{13})$/.exec(migration.name)?.[1]);
const BASELINE_6B = ALL_MIGRATIONS.filter((m) => stamp(m) <= 1740000000003);
const REFINEMENTS_6C = ALL_MIGRATIONS.filter((m) => stamp(m) >= 1740000000004 && stamp(m) <= 1740000000005);
const THROUGH_6C = [...BASELINE_6B, ...REFINEMENTS_6C];
const names = (list: readonly { name: string }[]): string[] => list.map((m) => m.name);

describeDb('Phase 6C migration upgrade/revert rehearsal (real MySQL)', () => {
  const database = `mczen_6c_mig_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const userId = uuidToBinary(newUuidv7());
  const sessionId = uuidToBinary(newUuidv7());
  let admin: Connection;
  let source: DataSource;
  let created = false;

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    created = true;
    const config = MysqlConfig.fromEnv({ ...process.env, DB_NAME: database });
    source = new DataSource({ ...config.toTypeormOptions(BASELINE_6B), entities: [], logging: false, migrationsTransactionMode: 'each' });
    await source.initialize();
    expect(BASELINE_6B).toHaveLength(3);
    expect(REFINEMENTS_6C).toHaveLength(2);
    expect(await source.runMigrations()).toHaveLength(3);
    await source.query("INSERT INTO `users` (`id`, `email`, `password_hash`, `token_version`) VALUES (?, 'legacy@example.test', 'legacy-digest-fixture', 7)", [userId]);
    await source.query('INSERT INTO `user_sessions` (`id`, `user_id`, `expires_at`) VALUES (?, ?, ?)', [sessionId, userId, new Date(Date.now() + 86_400_000)]);
    await source.destroy();
    source = new DataSource({ ...config.toTypeormOptions(THROUGH_6C), entities: [], logging: false, migrationsTransactionMode: 'each' });
    await source.initialize();
  });
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin) {
      if (created) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });

  it('upgrades the accepted 6B ledger by applying only migrations 4 and 5', async () => {
    expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(names(REFINEMENTS_6C));
    const [row] = await source.query('SELECT u.`password_hash`, u.`token_version` AS user_version, s.`token_version` AS session_version FROM `users` u JOIN `user_sessions` s ON s.`user_id` = u.`id` WHERE u.`id` = ?', [userId]) as Array<{ password_hash: string; user_version: number; session_version: number }>;
    expect(row.password_hash).toBe('legacy-digest-fixture');
    expect(Number(row.user_version)).toBe(7);
    expect(Number(row.session_version)).toBe(7);
    const tables = await source.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [database]) as Array<{ TABLE_NAME: string }>;
    expect(tables).toHaveLength(13); // original 12 incl. ledger + one pending-token table
    expect(tables.map((row) => row.TABLE_NAME)).toContain('auth_pending_tokens');
    expect(tables.map((row) => row.TABLE_NAME)).not.toContain('voice_sessions');
  });
  it('re-runs the full registry as a no-op', async () => {
    expect(await source.runMigrations()).toHaveLength(0);
    expect((await source.query('SELECT `name` FROM `migrations` ORDER BY `id`')).map((row: { name: string }) => row.name)).toEqual(names(THROUGH_6C));
  });
  it('reverts only the two 6C refinements and reapplies them without altering legacy users', async () => {
    await source.undoLastMigration();
    await source.undoLastMigration();
    const columns = await source.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_sessions'", [database]) as Array<{ COLUMN_NAME: string }>;
    expect(columns.map((row) => row.COLUMN_NAME)).not.toContain('token_version');
    expect((await source.query('SELECT `name` FROM `migrations` ORDER BY `id`')).map((row: { name: string }) => row.name)).toEqual(names(BASELINE_6B));
    expect((await source.runMigrations()).map((migration) => migration.name)).toEqual(names(REFINEMENTS_6C));
    const [row] = await source.query('SELECT `token_version` FROM `user_sessions` WHERE `id` = ?', [sessionId]) as Array<{ token_version: number }>;
    expect(Number(row.token_version)).toBe(7);
  });
});
