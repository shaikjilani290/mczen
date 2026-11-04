"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const typeorm_1 = require("typeorm");
const mysql_config_1 = require("./mysql-config");
const migrations_1 = require("./migrations");
(0, mysql_config_1.loadOptionalDotEnv)();
const config = mysql_config_1.MysqlConfig.fromMigrationEnv();
exports.default = new typeorm_1.DataSource({
    ...config.toTypeormOptions(migrations_1.ALL_MIGRATIONS),
    entities: [],
    migrationsRun: false,
    migrationsTransactionMode: 'each',
    logging: ['error', 'warn', 'info'],
});
//# sourceMappingURL=data-source.js.map