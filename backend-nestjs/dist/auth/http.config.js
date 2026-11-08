"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.corsOptionsForPath = corsOptionsForPath;
exports.configureHttpApplication = configureHttpApplication;
const rate_limit_service_1 = require("./rate-limit.service");
const trust_proxy_config_1 = require("./trust-proxy.config");
const cors_config_1 = require("./cors.config");
function corsOptionsForPath(path, cors) {
    const publicBrowserIntegration = cors_config_1.WEBSITE_PUBLIC_PATHS.includes(path);
    return path.startsWith(cors_config_1.WIDGET_PUBLIC_PATH) || publicBrowserIntegration ? cors_config_1.widgetCorsOptions : cors;
}
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
        callback(null, corsOptionsForPath(path, cors));
    });
}
//# sourceMappingURL=http.config.js.map