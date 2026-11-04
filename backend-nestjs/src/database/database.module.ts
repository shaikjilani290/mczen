import { DynamicModule, Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MysqlConfig, MYSQL_CONFIG } from './mysql-config';

export const DATABASE_STATUS = Symbol('DATABASE_STATUS');

export interface DatabaseStatus {
  configured: boolean;
  message: string;
}

/**
 * Phase 6B — MySQL foundation module (Phase 6A §12.1/§12.3).
 *
 * Behavior:
 * - `synchronize: false` is mandatory; schema changes come from migrations only.
 * - UTC connection timezone (`Z`) so DATETIME(3) columns round-trip deterministically.
 * - DEV WITHOUT DB ENV: boots with `configured: false` and no connection attempt
 *   (graceful mode) so the existing Phase 5 runtime keeps working.
 * - PRODUCTION WITHOUT DB ENV: hard-fails (fail-closed, per MysqlConfig).
 * - Connection lifecycle: the TypeORM module owns the DataSource; shutdown hooks
 *   (main.ts enableShutdownHooks) close the pool on SIGTERM/SIGINT.
 * - Consumers inject the live connection via `@InjectDataSource()`.
 */
@Module({})
export class DatabaseModule {
  private static readonly logger = new Logger(DatabaseModule.name);

  static forRoot(): DynamicModule {
    const config = MysqlConfig.fromEnvIfConfigured();

    if (!config) {
      const message =
        'Database environment (DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE) not configured — ' +
        'the application is running WITHOUT a database (development graceful mode).';
      this.logger.warn(message);
      return {
        module: DatabaseModule,
        providers: [{ provide: DATABASE_STATUS, useValue: { configured: false, message } }],
        exports: [DATABASE_STATUS],
      };
    }

    this.logger.log(
      `MySQL configured for db "${config.view.database}" at ${config.view.host}:${config.view.port} (synchronize: false)`,
    );

    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          // A parent module's providers are not visible in TypeOrmCoreModule.
          // Capture the validated config instead of injecting an invisible token.
          useFactory: () => ({
            ...config.toTypeormOptions(),
            // No runtime entities are registered in Phase 6B (the schema comes
            // from migrations; tenant repositories arrive in 6C–6G).
            entities: [],
            migrations: [],
            migrationsRun: false,
            logging: false, // SQL errors/parameters may contain password hashes.
            retryAttempts: 1,
          }),
        }),
      ],
      providers: [
        { provide: MYSQL_CONFIG, useValue: config },
        { provide: DATABASE_STATUS, useValue: { configured: true } },
      ],
      // TypeOrmCoreModule already globally exports the default DataSource class
      // token. A self-alias under that same token would create a DI cycle.
      exports: [DATABASE_STATUS, TypeOrmModule, MYSQL_CONFIG],
    };
  }
}
