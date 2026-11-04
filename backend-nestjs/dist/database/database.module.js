"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DatabaseModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = exports.DATABASE_STATUS = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const mysql_config_1 = require("./mysql-config");
exports.DATABASE_STATUS = Symbol('DATABASE_STATUS');
let DatabaseModule = class DatabaseModule {
    static { DatabaseModule_1 = this; }
    static logger = new common_1.Logger(DatabaseModule_1.name);
    static forRoot() {
        const config = mysql_config_1.MysqlConfig.fromEnvIfConfigured();
        if (!config) {
            const message = 'Database environment (DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE) not configured — ' +
                'the application is running WITHOUT a database (development graceful mode).';
            this.logger.warn(message);
            return {
                module: DatabaseModule_1,
                providers: [{ provide: exports.DATABASE_STATUS, useValue: { configured: false, message } }],
                exports: [exports.DATABASE_STATUS],
            };
        }
        this.logger.log(`MySQL configured for db "${config.view.database}" at ${config.view.host}:${config.view.port} (synchronize: false)`);
        return {
            module: DatabaseModule_1,
            imports: [
                typeorm_1.TypeOrmModule.forRootAsync({
                    useFactory: () => ({
                        ...config.toTypeormOptions(),
                        entities: [],
                        migrations: [],
                        migrationsRun: false,
                        logging: false,
                        retryAttempts: 1,
                    }),
                }),
            ],
            providers: [
                { provide: mysql_config_1.MYSQL_CONFIG, useValue: config },
                { provide: exports.DATABASE_STATUS, useValue: { configured: true } },
            ],
            exports: [exports.DATABASE_STATUS, typeorm_1.TypeOrmModule, mysql_config_1.MYSQL_CONFIG],
        };
    }
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = DatabaseModule_1 = __decorate([
    (0, common_1.Module)({})
], DatabaseModule);
//# sourceMappingURL=database.module.js.map