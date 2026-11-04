import { MigrationInterface } from 'typeorm';
import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';

export const DB_ENV_PREFIX = 'DB_';

/** Stable DI token for the resolved MySQL configuration. */
export const MYSQL_CONFIG = Symbol('MYSQL_CONFIG');

/** Structured footprint of the resolved MySQL configuration (never contains the password). */
export interface MysqlConfigView {
  host: string;
  port: number;
  user: string;
  database: string;
  connectTimeoutMs: number;
  connectionLimit: number;
}

/** Error thrown when the database environment is missing or invalid. */
export class DatabaseConfigError extends Error {
  readonly missingKeys?: string[];
  constructor(message: string, missingKeys?: string[]) {
    super(message);
    this.name = 'DatabaseConfigError';
    this.missingKeys = missingKeys;
  }
}

type Env = Record<string, string | undefined>;

function intFromEnv(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new DatabaseConfigError(
      `${key} must be an integer between ${min} and ${max} (received a value that is not valid).`,
    );
  }
  return parsed;
}

/**
 * Resolved MySQL configuration for McZEN.
 *
 * SECURITY CONTRACT (Phase 6A §12.2):
 * - Credentials come from environment variables only; nothing is hardcoded.
 * - Error messages NEVER echo the password (or any other secret).
 * - In production (NODE_ENV=production) a missing database configuration is a
 *   hard failure (fail closed). In development the application still boots
 *   without a database and the foundation module reports "database disabled".
 */
export class MysqlConfig {
  private constructor(
    readonly view: MysqlConfigView,
    // Held privately: never logged, never serialized, never exposed via DI.
    private readonly password: string,
  ) {}

  static fromEnv(env: Env = process.env): MysqlConfig {
    const username = env.DB_USERNAME ?? env.DB_USER;
    const database = env.DB_DATABASE ?? env.DB_NAME;
    const missing: string[] = [];
    if (env.DB_HOST === undefined || env.DB_HOST === '') missing.push('DB_HOST');
    if (env.DB_PORT === undefined || env.DB_PORT === '') missing.push('DB_PORT');
    if (username === undefined || username === '') missing.push('DB_USERNAME');
    if (database === undefined || database === '') missing.push('DB_DATABASE');
    // DB_PASSWORD may legitimately be empty (some local setups), but the key
    // itself must be present so that "I forgot to set it" is not silent.
    if (env.DB_PASSWORD === undefined) missing.push('DB_PASSWORD');

    if (missing.length > 0) {
      throw new DatabaseConfigError(
        `MySQL configuration is required but incomplete. Missing environment variables: ${missing.join(', ')}. ` +
          'Copy .env.example to .env (or export the variables) and try again.',
        missing,
      );
    }

    const resolvedDatabase = database as string;
    if (!/^[A-Za-z0-9_$]{1,64}$/.test(resolvedDatabase)) {
      throw new DatabaseConfigError(
        'DB_DATABASE is invalid: it must be 1-64 characters from [A-Za-z0-9_$] (MySQL identifier rules).',
      );
    }

    const host = env.DB_HOST as string;
    const port = intFromEnv(env, 'DB_PORT', 3306, 1, 65535);
    const user = username as string;
    // Kept in a closure the caller cannot read through the public view.
    const password = env.DB_PASSWORD as string;

    const connectTimeoutMs = intFromEnv(env, 'DB_CONNECT_TIMEOUT_MS', 10000, 1000, 120000);
    const connectionLimit = intFromEnv(env, 'DB_CONNECTION_LIMIT', 10, 1, 200);

    return new MysqlConfig(
      { host, port, user, database: resolvedDatabase, connectTimeoutMs, connectionLimit },
      password,
    );
  }

  /**
   * Configuration for operator-run migrations. Uses the same host/port/database
   * as the runtime but REQUIRES separate DB_MIGRATION_USERNAME/PASSWORD, so the
   * least-privileged runtime account is never used (or needed) for DDL.
   */
  static fromMigrationEnv(env: Env = process.env): MysqlConfig {
    const missing: string[] = [];
    if (!env.DB_MIGRATION_USERNAME) missing.push('DB_MIGRATION_USERNAME');
    if (env.DB_MIGRATION_PASSWORD === undefined) missing.push('DB_MIGRATION_PASSWORD');
    if (missing.length > 0) {
      throw new DatabaseConfigError(
        `Migration credentials are required and are separate from the runtime user. Missing environment variables: ${missing.join(', ')}.`,
        missing,
      );
    }
    return MysqlConfig.fromEnv({
      ...env,
      DB_USERNAME: env.DB_MIGRATION_USERNAME,
      DB_USER: undefined,
      DB_PASSWORD: env.DB_MIGRATION_PASSWORD,
    });
  }

  static isProduction(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
    return nodeEnv === 'production';
  }

  /** True when no database env is present and the environment may boot anyway. */
  static fromEnvIfConfigured(
    env: Env = process.env,
  ): MysqlConfig | null {
    try {
      return MysqlConfig.fromEnv(env);
    } catch (error) {
      if (
        error instanceof DatabaseConfigError &&
        !MysqlConfig.isProduction(env.NODE_ENV)
      ) {
        return null; // dev: boot without a database (documented graceful mode)
      }
      throw error; // production: fail closed
    }
  }

  /**
   * TypeORM connection options (Phase 6A §12.1/§12.3).
   * Returns the concrete MySQL driver options so both `DataSource` (CLI) and
   * `TypeOrmModule.forRootAsync` (runtime) can consume them directly.
   */
  toTypeormOptions(
    migrations?: readonly (new () => MigrationInterface)[],
  ): MysqlConnectionOptions {
    const options: MysqlConnectionOptions = {
      type: 'mysql',
      host: this.view.host,
      port: this.view.port,
      username: this.view.user,
      password: this.password,
      database: this.view.database,
      // Phase 6A §12.3 rule 1: migrations only, never auto-schema.
      synchronize: false,
      // Phase 6A §12.3 rule 7: deterministic UTC DATETIME(3).
      timezone: 'Z',
      charset: 'utf8mb4',
      connectTimeout: this.view.connectTimeoutMs,
      extra: {
        connectionLimit: this.view.connectionLimit,
        // Clear-text passwords must never leak through mysql2 debug output.
        debug: false,
      },
      ...(migrations !== undefined
        ? {
            migrations: [...migrations] as unknown as MysqlConnectionOptions['migrations'],
            migrationsRun: false,
            logging: ['error', 'warn'],
          }
        : {}),
    };
    return options;
  }
}

/**
 * Loads an optional .env file with Node's native loader, mirroring main.ts
 * (shell values win; an existing .env is never created, rewritten or logged).
 * The CLI entrypoint (data-source.ts) cannot rely on Nest bootstrap, so the
 * identical behavior is centralized here.
 */
export function loadOptionalDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('The backend environment file could not be loaded.');
    }
  }
}
