"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUEST_ID = exports.TENANT_CONTEXT = exports.AUTH_CONTEXT = void 0;
exports.attachContext = attachContext;
exports.AUTH_CONTEXT = Symbol('MCZEN_AUTH_CONTEXT');
exports.TENANT_CONTEXT = Symbol('MCZEN_TENANT_CONTEXT');
exports.REQUEST_ID = Symbol('MCZEN_REQUEST_ID');
function attachContext(request, user, tenant) {
    if (user)
        Object.defineProperty(request, exports.AUTH_CONTEXT, { value: Object.freeze({ ...user }) });
    if (tenant)
        Object.defineProperty(request, exports.TENANT_CONTEXT, {
            value: Object.freeze({ ...tenant, permissions: Object.freeze([...tenant.permissions]) }),
        });
}
//# sourceMappingURL=auth-context.js.map