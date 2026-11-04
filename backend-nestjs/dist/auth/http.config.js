"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureHttpApplication = configureHttpApplication;
const rate_limit_service_1 = require("./rate-limit.service");
const trust_proxy_config_1 = require("./trust-proxy.config");
const cors_config_1 = require("./cors.config");
function configureHttpApplication(app, cors) {
    const express = app.getHttpAdapter().getInstance();
    express.set('trust proxy', (0, trust_proxy_config_1.readTrustProxySetting)());
    express.disable('x-powered-by');
    const rate = app.get(rate_limit_service_1.RateLimitService);
    app.use((request, response, next) => {
        try {
            rate.checkEdge(request, response);
            next();
        }
        catch (error) {
            next(error);
        }
    });
    app.enableCors((request, callback) => {
        const path = (request.url ?? '').split('?')[0];
        callback(null, path.startsWith(cors_config_1.WIDGET_PUBLIC_PATH) ? cors_config_1.widgetCorsOptions : cors);
    });
}
//# sourceMappingURL=http.config.js.map