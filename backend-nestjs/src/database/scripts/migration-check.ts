import { DataSource } from 'typeorm';
/**
 * Phase 6B — migration status check (Phase 6A §12.1 "migration:show" support +
 * a stricter CI-friendly exit code).
 *
 * Compares the migration registry (src/database/migrations/index.ts) against the
 * `migrations` table in the configured database and prints:
 *   - applied migrations (in execution order)
 *   - pending migrations (not yet applied)
 *   - unknown rows (executed names that are no longer in the registry — these
 *     require operator attention instead of failing silently)
 *
 * Exit codes: 0 = nothing pending and no unknown rows; 1 = pending or unknown.
 * Secrets are never printed (MysqlConfig guarantees no-password messages).
 */
import { MysqlConfig, loadOptionalDotEnv } from '../mysql-config';
import { ALL_MIGRATIONS } from '../migrations';

loadOptionalDotEnv();

async function main(): Promise<number> {
  const config = MysqlConfig.fromMigrationEnv();
  const dataSource = new DataSource(config.toTypeormOptions(ALL_MIGRATIONS));
  await dataSource.initialize();
  try {
    const classes = ALL_MIGRATIONS.map((m) => new m());
    const classNames = classes.map((c) => c.name ?? c.constructor.name);
    const registered = new Set(classNames);
    const executed = new Set<string>();
    const unknownRows: string[] = [];
    let tableMissing = false;
    try {
      const rows = (await dataSource.query('SELECT `name` FROM `migrations` ORDER BY `name`')) as Array<{
        name: string;
      }>;
      for (const row of rows) executed.add(row.name);
    } catch {
      tableMissing = true; // `migrations` table absent on a fresh database
    }

    const applied = classNames.filter((name) => executed.has(name));
    const pending = classNames.filter((name) => !executed.has(name));
    for (const row of executed) {
      if (!registered.has(row)) unknownRows.push(row);
    }

    if (tableMissing) {
      console.log(`[migration:check] database "${config.view.database}": migrations table missing.`);
    }
    for (const name of applied) console.log(`[migration:check] APPLIED  ${name}`);
    for (const name of pending) console.log(`[migration:check] PENDING  ${name}`);
    for (const name of unknownRows) console.log(`[migration:check] UNKNOWN  ${name} (not in registry — review!)`);
    console.log(
      `[migration:check] summary: ${applied.length} applied, ${pending.length} pending, ${unknownRows.length} unknown.`,
    );
    return pending.length > 0 || unknownRows.length > 0 ? 1 : 0;
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then((code) => process.exitCode = code)
  .catch((error: unknown) => {
    console.error('[migration:check] failed:', (error as Error).message);
    process.exitCode = 1;
  });
