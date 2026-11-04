"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const typeorm_1 = require("typeorm");
const mysql_config_1 = require("../mysql-config");
(0, mysql_config_1.loadOptionalDotEnv)();
async function main() {
    let dataSource;
    try {
        const config = mysql_config_1.MysqlConfig.fromEnv();
        dataSource = new typeorm_1.DataSource({
            ...config.toTypeormOptions(),
            entities: [],
            migrations: [],
            migrationsRun: false,
            logging: false,
        });
        await dataSource.initialize();
        const [identity] = (await dataSource.query('SELECT VERSION() AS version, DATABASE() AS databaseName, CURRENT_USER() AS currentUser'));
        console.log(`[database:check] MySQL version: ${identity.version}`);
        console.log(`[database:check] Database: ${identity.databaseName ?? '(none)'}`);
        console.log(`[database:check] Authenticated account: ${identity.currentUser}`);
    }
    catch (error) {
        const code = typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
            ? error.code
            : undefined;
        console.error(`[database:check] failed${code ? ` (${code})` : ''}. Check the database environment and SSH tunnel; no credentials were printed.`);
        process.exitCode = 1;
    }
    finally {
        if (dataSource?.isInitialized) {
            try {
                await dataSource.destroy();
            }
            catch {
                console.error('[database:check] connection cleanup failed.');
                process.exitCode = 1;
            }
        }
    }
}
void main();
//# sourceMappingURL=database-check.js.map