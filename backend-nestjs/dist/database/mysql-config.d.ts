import { MigrationInterface } from 'typeorm';
import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
export declare const DB_ENV_PREFIX = "DB_";
export declare const MYSQL_CONFIG: unique symbol;
export interface MysqlConfigView {
    host: string;
    port: number;
    user: string;
    database: string;
    connectTimeoutMs: number;
    connectionLimit: number;
}
export declare class DatabaseConfigError extends Error {
    readonly missingKeys?: string[];
    constructor(message: string, missingKeys?: string[]);
}
type Env = Record<string, string | undefined>;
export declare class MysqlConfig {
    readonly view: MysqlConfigView;
    private readonly password;
    private constructor();
    static fromEnv(env?: Env): MysqlConfig;
    static fromMigrationEnv(env?: Env): MysqlConfig;
    static isProduction(nodeEnv?: string | undefined): boolean;
    static fromEnvIfConfigured(env?: Env): MysqlConfig | null;
    toTypeormOptions(migrations?: readonly (new () => MigrationInterface)[]): MysqlConnectionOptions;
}
export declare function loadOptionalDotEnv(): void;
export {};
