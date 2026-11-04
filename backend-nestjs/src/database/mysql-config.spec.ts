import {
  MysqlConfig,
  DatabaseConfigError,
  MYSQL_CONFIG,
  loadOptionalDotEnv,
} from './mysql-config';

const BASE_ENV: Record<string, string> = {
  DB_HOST: 'db.internal',
  DB_PORT: '3306',
  DB_USERNAME: 'mczen_app',
  DB_PASSWORD: 's3cret-password',
  DB_DATABASE: 'mczen',
};

describe('MysqlConfig (Phase 6B)', () => {
  it('resolves a complete environment into a no-password view', () => {
    const config = MysqlConfig.fromEnv(BASE_ENV);
    expect(config.view).toEqual({
      host: 'db.internal',
      port: 3306,
      user: 'mczen_app',
      database: 'mczen',
      connectTimeoutMs: 10000,
      connectionLimit: 10,
    });
    // The password must never appear in the exposed view.
    expect(JSON.stringify(config.view)).not.toContain('s3cret-password');
  });

  it('accepts an empty DB_PASSWORD only when the key itself is present', () => {
    const config = MysqlConfig.fromEnv({ ...BASE_ENV, DB_PASSWORD: '' });
    expect(config.view.user).toBe('mczen_app');
  });

  it('fails closed with the missing variable names (no secret echoes)', () => {
    const partial = { ...BASE_ENV } as Record<string, string | undefined>;
    delete partial.DB_PASSWORD;
    delete partial.DB_HOST;

    let caught: unknown;
    try {
      MysqlConfig.fromEnv(partial);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatabaseConfigError);
    const err = caught as DatabaseConfigError;
    expect(err.missingKeys).toEqual(['DB_HOST', 'DB_PASSWORD']);
    expect(err.message).toContain('DB_HOST');
    expect(err.message).not.toContain('s3cret-password');
    // The DI token is a stable Symbol carrying a human-readable description.
    expect(typeof MYSQL_CONFIG).toBe('symbol');
    expect((MYSQL_CONFIG as { description?: string }).description).toBe('MYSQL_CONFIG');
  });

  it('rejects invalid DB_PORT and DB_DATABASE values', () => {
    expect(() => MysqlConfig.fromEnv({ ...BASE_ENV, DB_PORT: 'not-a-port' })).toThrow(
      DatabaseConfigError,
    );
    expect(() => MysqlConfig.fromEnv({ ...BASE_ENV, DB_PORT: '70000' })).toThrow(
      DatabaseConfigError,
    );
    expect(() => MysqlConfig.fromEnv({ ...BASE_ENV, DB_DATABASE: 'bad name!' })).toThrow(
      DatabaseConfigError,
    );
    expect(() => MysqlConfig.fromEnv({ ...BASE_ENV, DB_DATABASE: '' })).toThrow(DatabaseConfigError);
  });

  it('prefers DB_USERNAME and DB_DATABASE, retaining the legacy aliases', () => {
    const config = MysqlConfig.fromEnv({
      ...BASE_ENV,
      DB_USERNAME: 'mczen_app',
      DB_USER: 'mczen_migrator',
      DB_DATABASE: 'mczen_db',
      DB_NAME: 'legacy_db',
    });
    expect(config.view.user).toBe('mczen_app');
    expect(config.view.database).toBe('mczen_db');

    const legacy = MysqlConfig.fromEnv({
      DB_HOST: 'db.internal',
      DB_PORT: '3306',
      DB_USER: 'mczen_app',
      DB_PASSWORD: 's3cret-password',
      DB_NAME: 'mczen',
    });
    expect(legacy.view.user).toBe('mczen_app');
    expect(legacy.view.database).toBe('mczen');
  });

  it('production boots fail closed; development may boot without a database', () => {
    const partialEnv = { NODE_ENV: 'production' } as Record<string, string | undefined>;
    expect(() => MysqlConfig.fromEnvIfConfigured(partialEnv)).toThrow(DatabaseConfigError);
    expect(MysqlConfig.isProduction('production')).toBe(true);
    expect(MysqlConfig.isProduction('development')).toBe(false);
    expect(MysqlConfig.isProduction(undefined)).toBe(false);

    expect(MysqlConfig.fromEnvIfConfigured({} as Record<string, string | undefined>)).toBeNull();
    expect(
      MysqlConfig.fromEnvIfConfigured({ NODE_ENV: 'production', ...BASE_ENV }),
    ).toBeInstanceOf(MysqlConfig);
  });

  it('migration config uses separate credentials and never falls back to the runtime user', () => {
    expect(() => MysqlConfig.fromMigrationEnv(BASE_ENV)).toThrow(DatabaseConfigError);
    const migration = MysqlConfig.fromMigrationEnv({
      ...BASE_ENV,
      DB_MIGRATION_USERNAME: 'mczen_migrator',
      DB_MIGRATION_PASSWORD: 'migrator-secret',
    });
    expect(migration.view.user).toBe('mczen_migrator');
    expect(migration.view.database).toBe('mczen');
    expect(JSON.stringify(migration.view)).not.toContain('migrator-secret');
    expect(MysqlConfig.fromEnv(BASE_ENV).view.user).toBe('mczen_app');
  });

  it('TypeORM options pin synchronize:false, UTC and utf8mb4', () => {
    const withMigrations = MysqlConfig.fromEnv(BASE_ENV).toTypeormOptions([
      class Fake {
        up(): Promise<void> { return Promise.resolve(); }
        down(): Promise<void> { return Promise.resolve(); }
      },
    ]);
    expect(withMigrations).toMatchObject({
      type: 'mysql',
      host: 'db.internal',
      port: 3306,
      username: 'mczen_app',
      password: 's3cret-password', // remains available to the driver only
      database: 'mczen',
      synchronize: false, // mandatory rule: no auto-schema, ever
      timezone: 'Z', // deterministic UTC DATETIME(3)
      charset: 'utf8mb4',
      migrationsRun: false,
      extra: { connectionLimit: 10, debug: false },
    });
    expect(withMigrations.entities).toBeUndefined();

    // The runtime path registers NO migrations and NO entities (6B scope).
    const runtime = MysqlConfig.fromEnv(BASE_ENV).toTypeormOptions();
    expect(runtime).not.toHaveProperty('migrations');
    expect(JSON.stringify(runtime)).not.toContain('migrationsRun');
  });

  it('loadOptionalDotEnv tolerates a missing .env without touching it', () => {
    expect(() => loadOptionalDotEnv()).not.toThrow();
  });
});
