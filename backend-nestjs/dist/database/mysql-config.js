"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MysqlConfig = exports.DatabaseConfigError = exports.MYSQL_CONFIG = exports.DB_ENV_PREFIX = void 0;
exports.loadOptionalDotEnv = loadOptionalDotEnv;
exports.DB_ENV_PREFIX = 'DB_';
exports.MYSQL_CONFIG = Symbol('MYSQL_CONFIG');
class DatabaseConfigError extends Error {
    missingKeys;
    constructor(message, missingKeys) {
        super(message);
        this.name = 'DatabaseConfigError';
        this.missingKeys = missingKeys;
    }
}
exports.DatabaseConfigError = DatabaseConfigError;
function intFromEnv(env, key, fallback, min, max) {
    const raw = env[key];
    if (raw === undefined || raw === '')
        return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        throw new DatabaseConfigError(`${key} must be an integer between ${min} and ${max} (received a value that is not valid).`);
    }
    return parsed;
}
class MysqlConfig {
    view;
    password;
    constructor(view, password) {
        this.view = view;
        this.password = password;
    }
    static fromEnv(env = process.env) {
        const username = env.DB_USERNAME ?? env.DB_USER;
        const database = env.DB_DATABASE ?? env.DB_NAME;
        const missing = [];
        if (env.DB_HOST === undefined || env.DB_HOST === '')
            missing.push('DB_HOST');
        if (env.DB_PORT === undefined || env.DB_PORT === '')
            missing.push('DB_PORT');
        if (username === undefined || username === '')
            missing.push('DB_USERNAME');
        if (database === undefined || database === '')
            missing.push('DB_DATABASE');
        if (env.DB_PASSWORD === undefined)
            missing.push('DB_PASSWORD');
        if (missing.length > 0) {
            throw new DatabaseConfigError(`MySQL configuration is required but incomplete. Missing environment variables: ${missing.join(', ')}. ` +
                'Copy .env.example to .env (or export the variables) and try again.', missing);
        }
        const resolvedDatabase = database;
        if (!/^[A-Za-z0-9_$]{1,64}$/.test(resolvedDatabase)) {
            throw new DatabaseConfigError('DB_DATABASE is invalid: it must be 1-64 characters from [A-Za-z0-9_$] (MySQL identifier rules).');
        }
        const host = env.DB_HOST;
        const port = intFromEnv(env, 'DB_PORT', 3306, 1, 65535);
        const user = username;
        const password = env.DB_PASSWORD;
        const connectTimeoutMs = intFromEnv(env, 'DB_CONNECT_TIMEOUT_MS', 10000, 1000, 120000);
        const connectionLimit = intFromEnv(env, 'DB_CONNECTION_LIMIT', 10, 1, 200);
        return new MysqlConfig({ host, port, user, database: resolvedDatabase, connectTimeoutMs, connectionLimit }, password);
    }
    static fromMigrationEnv(env = process.env) {
        const missing = [];
        if (!env.DB_MIGRATION_USERNAME)
            missing.push('DB_MIGRATION_USERNAME');
        if (env.DB_MIGRATION_PASSWORD === undefined)
            missing.push('DB_MIGRATION_PASSWORD');
        if (missing.length > 0) {
            throw new DatabaseConfigError(`Migration credentials are required and are separate from the runtime user. Missing environment variables: ${missing.join(', ')}.`, missing);
        }
        return MysqlConfig.fromEnv({
            ...env,
            DB_USERNAME: env.DB_MIGRATION_USERNAME,
            DB_USER: undefined,
            DB_PASSWORD: env.DB_MIGRATION_PASSWORD,
        });
    }
    static isProduction(nodeEnv = process.env.NODE_ENV) {
        return nodeEnv === 'production';
    }
    static fromEnvIfConfigured(env = process.env) {
        try {
            return MysqlConfig.fromEnv(env);
        }
        catch (error) {
            if (error instanceof DatabaseConfigError &&
                !MysqlConfig.isProduction(env.NODE_ENV)) {
                return null;
            }
            throw error;
        }
    }
    toTypeormOptions(migrations) {
        const options = {
            type: 'mysql',
            host: this.view.host,
            port: this.view.port,
            username: this.view.user,
            password: this.password,
            database: this.view.database,
            synchronize: false,
            timezone: 'Z',
            charset: 'utf8mb4',
            connectTimeout: this.view.connectTimeoutMs,
            extra: {
                connectionLimit: this.view.connectionLimit,
                debug: false,
            },
            ...(migrations !== undefined
                ? {
                    migrations: [...migrations],
                    migrationsRun: false,
                    logging: ['error', 'warn'],
                }
                : {}),
        };
        return options;
    }
}
exports.MysqlConfig = MysqlConfig;
function loadOptionalDotEnv() {
    try {
        process.loadEnvFile();
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw new Error('The backend environment file could not be loaded.');
        }
    }
}
//# sourceMappingURL=mysql-config.js.map