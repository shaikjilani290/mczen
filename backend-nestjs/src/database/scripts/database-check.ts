import { DataSource } from 'typeorm';
import { MysqlConfig, loadOptionalDotEnv } from '../mysql-config';

loadOptionalDotEnv();

async function main(): Promise<void> {
  let dataSource: DataSource | undefined;
  try {
    const config = MysqlConfig.fromEnv();
    dataSource = new DataSource({
      ...config.toTypeormOptions(),
      entities: [],
      migrations: [],
      migrationsRun: false,
      logging: false,
    });
    await dataSource.initialize();
    const [identity] = (await dataSource.query(
      'SELECT VERSION() AS version, DATABASE() AS databaseName, CURRENT_USER() AS currentUser',
    )) as Array<{ version: string; databaseName: string | null; currentUser: string }>;

    console.log(`[database:check] MySQL version: ${identity.version}`);
    console.log(`[database:check] Database: ${identity.databaseName ?? '(none)'}`);
    console.log(`[database:check] Authenticated account: ${identity.currentUser}`);
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : undefined;
    console.error(
      `[database:check] failed${code ? ` (${code})` : ''}. Check the database environment and SSH tunnel; no credentials were printed.`,
    );
    process.exitCode = 1;
  } finally {
    if (dataSource?.isInitialized) {
      try {
        await dataSource.destroy();
      } catch {
        console.error('[database:check] connection cleanup failed.');
        process.exitCode = 1;
      }
    }
  }
}

void main();
