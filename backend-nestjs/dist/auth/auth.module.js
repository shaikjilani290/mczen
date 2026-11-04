"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const agent_module_1 = require("../agent/agent.module");
const auth_controller_1 = require("./auth.controller");
const auth_service_1 = require("./auth.service");
const auth_store_service_1 = require("./auth-store.service");
const auth_mailer_1 = require("./auth.mailer");
const password_service_1 = require("./password.service");
const token_service_1 = require("./token.service");
const rate_limit_service_1 = require("./rate-limit.service");
const safe_http_exception_filter_1 = require("./safe-http-exception.filter");
const tenant_context_guard_1 = require("../common/tenant/tenant-context.guard");
const tenant_context_interceptor_1 = require("../common/tenant/tenant-context.interceptor");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [agent_module_1.AgentModule],
        controllers: [auth_controller_1.AuthController],
        providers: [
            auth_service_1.AuthService, auth_store_service_1.AuthStore, password_service_1.PasswordService,
            { provide: token_service_1.TokenService, useFactory: () => new token_service_1.TokenService() },
            { provide: auth_mailer_1.AuthMailer, useFactory: () => new auth_mailer_1.AuthMailer() },
            { provide: rate_limit_service_1.RateLimitService, useFactory: () => new rate_limit_service_1.RateLimitService() },
            tenant_context_guard_1.TenantAuthGuard,
            { provide: core_1.APP_GUARD, useExisting: tenant_context_guard_1.TenantAuthGuard },
            { provide: core_1.APP_INTERCEPTOR, useClass: tenant_context_interceptor_1.TenantContextInterceptor },
            { provide: core_1.APP_FILTER, useClass: safe_http_exception_filter_1.SafeHttpExceptionFilter },
        ],
        exports: [auth_service_1.AuthService, auth_store_service_1.AuthStore, password_service_1.PasswordService, token_service_1.TokenService, rate_limit_service_1.RateLimitService],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map