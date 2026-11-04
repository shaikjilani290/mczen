"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantContextStore = exports.TenantContextStore = exports.TenantContextMissingError = void 0;
const node_async_hooks_1 = require("node:async_hooks");
class TenantContextMissingError extends Error {
    constructor(message = 'Tenant context is not established for this operation.') {
        super(message);
        this.name = 'TenantContextMissingError';
    }
}
exports.TenantContextMissingError = TenantContextMissingError;
class TenantContextStore {
    als = new node_async_hooks_1.AsyncLocalStorage();
    run(context, fn) {
        return this.als.run(context, fn);
    }
    get() {
        return this.als.getStore();
    }
    getOrThrow() {
        const ctx = this.als.getStore();
        if (!ctx) {
            throw new TenantContextMissingError();
        }
        return ctx;
    }
    isActive() {
        return this.als.getStore() !== undefined;
    }
}
exports.TenantContextStore = TenantContextStore;
exports.tenantContextStore = new TenantContextStore();
//# sourceMappingURL=tenant-context.store.js.map