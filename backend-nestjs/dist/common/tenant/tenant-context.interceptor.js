"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantContextInterceptor = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const auth_context_1 = require("../../auth/auth-context");
const tenant_context_store_1 = require("./tenant-context.store");
let TenantContextInterceptor = class TenantContextInterceptor {
    intercept(context, next) {
        const tenant = context.switchToHttp().getRequest()[auth_context_1.TENANT_CONTEXT];
        if (!tenant)
            return next.handle();
        return new rxjs_1.Observable((subscriber) => {
            const subscription = tenant_context_store_1.tenantContextStore.run(tenant, () => next.handle().subscribe({
                next: (value) => tenant_context_store_1.tenantContextStore.run(tenant, () => subscriber.next(value)),
                error: (error) => tenant_context_store_1.tenantContextStore.run(tenant, () => subscriber.error(error)),
                complete: () => tenant_context_store_1.tenantContextStore.run(tenant, () => subscriber.complete()),
            }));
            return () => tenant_context_store_1.tenantContextStore.run(tenant, () => subscription.unsubscribe());
        });
    }
};
exports.TenantContextInterceptor = TenantContextInterceptor;
exports.TenantContextInterceptor = TenantContextInterceptor = __decorate([
    (0, common_1.Injectable)()
], TenantContextInterceptor);
//# sourceMappingURL=tenant-context.interceptor.js.map