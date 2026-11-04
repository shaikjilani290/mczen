"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const cors_config_1 = require("./auth/cors.config");
const http_config_1 = require("./auth/http.config");
const production_config_1 = require("./config/production-config");
const mysql_config_1 = require("./database/mysql-config");
async function bootstrap() {
    (0, mysql_config_1.loadOptionalDotEnv)();
    (0, production_config_1.assertProductionConfig)();
    const cors = (0, cors_config_1.readCorsOptions)();
    const { AppModule } = await import('./app.module.js');
    const app = await core_1.NestFactory.create(AppModule);
    app.enableShutdownHooks();
    (0, http_config_1.configureHttpApplication)(app, cors);
    await app.listen(process.env.PORT ?? 3000);
    console.log(`McZEN API running at ${await app.getUrl()}`);
}
void bootstrap();
//# sourceMappingURL=main.js.map