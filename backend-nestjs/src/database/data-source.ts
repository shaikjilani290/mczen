import { DataSource } from 'typeorm';
/**
 * Phase 6B — TypeORM CLI entrypoint (Phase 6A §12.2 rule 2).
 *
 * Used exclusively by package.json migration:* scripts, e.g.:
 *   npm run migration:run
 *   npm run migration:revert
 *   npm run migration:show
 *
 * - Reads .env (if present) through the same loader as main.ts; shell values win.
 * - Requires a COMPLETE database configuration regardless of NODE_ENV: the CLI
 *   is an explicit operator action, so the server-side "graceful mode" does not
 *   apply — a missing DB_* variable fails with DatabaseConfigError before any
 *   connection attempt, with a message that does not echo secrets.
 * - `synchronize: false`, UTC timezone, and the explicit migration registry
 *   (migrations/index.ts) are authoritative — no filesystem globs for migrations.
 */
import { MysqlConfig, loadOptionalDotEnv } from './mysql-config';
import { ALL_MIGRATIONS } from './migrations';

loadOptionalDotEnv();

const config = MysqlConfig.fromMigrationEnv();

export default new DataSource({
  ...config.toTypeormOptions(ALL_MIGRATIONS),
  entities: [],
  migrationsRun: false, // always operator- or CI-driven, never boot-implicit
  // MySQL DDL auto-commits even inside transactions (§12.3 rule 1); 'each'
  // keeps seed-data failure isolation bounded per migration.
  migrationsTransactionMode: 'each' as const,
  logging: ['error', 'warn', 'info'],
});
