"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantScopedRepository = void 0;
const tenant_context_store_1 = require("./tenant-context.store");
class TenantScopedRepository {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    currentTenantId() {
        const ctx = tenant_context_store_1.tenantContextStore.get();
        if (!ctx) {
            throw new tenant_context_store_1.TenantContextMissingError('A tenant-scoped repository operation ran without an established tenant context.');
        }
        return ctx.tenantId;
    }
}
exports.TenantScopedRepository = TenantScopedRepository;
//# sourceMappingURL=tenant-scoped.repository.js.map