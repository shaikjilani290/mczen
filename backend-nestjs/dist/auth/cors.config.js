"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.widgetCorsOptions = exports.WIDGET_PUBLIC_PATH = exports.CorsConfigError = void 0;
exports.readCorsOptions = readCorsOptions;
const common_1 = require("@nestjs/common");
const tenant_context_service_1 = require("../agent/context/tenant-context.service");
class CorsConfigError extends Error {
}
exports.CorsConfigError = CorsConfigError;
exports.WIDGET_PUBLIC_PATH = '/api/widget/public/';
exports.widgetCorsOptions = {
    origin: true,
    credentials: false,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
};
function readCorsOptions(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const raw = env.MCZEN_CORS_ORIGINS ?? (production ? '' : 'http://localhost:5174,http://127.0.0.1:5174');
    if (raw.length > 8192)
        throw new CorsConfigError('MCZEN_CORS_ORIGINS is too long.');
    const origins = raw.split(',').map((value) => value.trim()).filter(Boolean);
    if (origins.length > 32)
        throw new CorsConfigError('MCZEN_CORS_ORIGINS allows at most 32 origins.');
    for (const origin of origins) {
        try {
            const url = new URL(origin);
            if (url.origin !== origin || url.username || url.password || !['https:', ...(production ? [] : ['http:'])].includes(url.protocol))
                throw new Error();
        }
        catch {
            throw new CorsConfigError('MCZEN_CORS_ORIGINS must contain exact HTTP(S) origins; production requires HTTPS.');
        }
    }
    const allowed = new Set(origins);
    return {
        origin: (origin, callback) => {
            if (origin === undefined || allowed.has(origin))
                callback(null, true);
            else
                callback(new common_1.ForbiddenException('Origin is not allowed.'), false);
        },
        credentials: false,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', ...(!production && env.MCZEN_ALLOW_DEV_HEADER === '1' ? [tenant_context_service_1.DEV_TENANT_HEADER] : [])],
        exposedHeaders: ['X-Request-Id', 'Retry-After', 'Content-Disposition'],
        maxAge: 600,
    };
}
//# sourceMappingURL=cors.config.js.map