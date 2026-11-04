"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const typeorm_1 = require("typeorm");
const mysql_config_1 = require("../mysql-config");
const migrations_1 = require("../migrations");
(0, mysql_config_1.loadOptionalDotEnv)();
async function main() {
    const config = mysql_config_1.MysqlConfig.fromMigrationEnv();
    const dataSource = new typeorm_1.DataSource(config.toTypeormOptions(migrations_1.ALL_MIGRATIONS));
    await dataSource.initialize();
    try {
        const classes = migrations_1.ALL_MIGRATIONS.map((m) => new m());
        const classNames = classes.map((c) => c.name ?? c.constructor.name);
        const registered = new Set(classNames);
        const executed = new Set();
        const unknownRows = [];
        let tableMissing = false;
        try {
            const rows = (await dataSource.query('SELECT `name` FROM `migrations` ORDER BY `name`'));
            for (const row of rows)
                executed.add(row.name);
        }
        catch {
            tableMissing = true;
        }
        const applied = classNames.filter((name) => executed.has(name));
        const pending = classNames.filter((name) => !executed.has(name));
        for (const row of executed) {
            if (!registered.has(row))
                unknownRows.push(row);
        }
        if (tableMissing) {
            console.log(`[migration:check] database "${config.view.database}": migrations table missing.`);
        }
        for (const name of applied)
            console.log(`[migration:check] APPLIED  ${name}`);
        for (const name of pending)
            console.log(`[migration:check] PENDING  ${name}`);
        for (const name of unknownRows)
            console.log(`[migration:check] UNKNOWN  ${name} (not in registry — review!)`);
        console.log(`[migration:check] summary: ${applied.length} applied, ${pending.length} pending, ${unknownRows.length} unknown.`);
        return pending.length > 0 || unknownRows.length > 0 ? 1 : 0;
    }
    finally {
        await dataSource.destroy();
    }
}
main()
    .then((code) => process.exitCode = code)
    .catch((error) => {
    console.error('[migration:check] failed:', error.message);
    process.exitCode = 1;
});
//# sourceMappingURL=migration-check.js.map