"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentTenant = exports.CurrentUser = exports.AuthRateLimit = exports.AllowDevHeader = exports.RequirePlatform = exports.RequirePermission = exports.IdentityOnly = exports.PublicRoute = exports.AUTH_RATE_POLICY = exports.DEV_HEADER_ALLOWED = exports.REQUIRED_PERMISSIONS = exports.AUTH_MODE = void 0;
const common_1 = require("@nestjs/common");
const auth_context_1 = require("./auth-context");
const tenant_context_store_1 = require("../common/tenant/tenant-context.store");
exports.AUTH_MODE = Symbol('MCZEN_AUTH_MODE');
exports.REQUIRED_PERMISSIONS = Symbol('MCZEN_REQUIRED_PERMISSIONS');
exports.DEV_HEADER_ALLOWED = Symbol('MCZEN_DEV_HEADER_ALLOWED');
exports.AUTH_RATE_POLICY = Symbol('MCZEN_AUTH_RATE_POLICY');
const PublicRoute = () => (0, common_1.SetMetadata)(exports.AUTH_MODE, 'public');
exports.PublicRoute = PublicRoute;
const IdentityOnly = () => (0, common_1.SetMetadata)(exports.AUTH_MODE, 'identity');
exports.IdentityOnly = IdentityOnly;
const RequirePermission = (...permissions) => (0, common_1.SetMetadata)(exports.REQUIRED_PERMISSIONS, Object.freeze([...permissions]));
exports.RequirePermission = RequirePermission;
const RequirePlatform = (...permissions) => (0, common_1.applyDecorators)((0, common_1.SetMetadata)(exports.AUTH_MODE, 'platform'), (0, exports.RequirePermission)(...permissions));
exports.RequirePlatform = RequirePlatform;
const AllowDevHeader = () => (0, common_1.SetMetadata)(exports.DEV_HEADER_ALLOWED, true);
exports.AllowDevHeader = AllowDevHeader;
const AuthRateLimit = (policy) => (0, common_1.SetMetadata)(exports.AUTH_RATE_POLICY, policy);
exports.AuthRateLimit = AuthRateLimit;
exports.CurrentUser = (0, common_1.createParamDecorator)((_data, context) => {
    const user = context.switchToHttp().getRequest()[auth_context_1.AUTH_CONTEXT];
    if (!user)
        throw new common_1.UnauthorizedException('Authentication required.');
    return user;
});
exports.CurrentTenant = (0, common_1.createParamDecorator)(() => tenant_context_store_1.tenantContextStore.getOrThrow());
//# sourceMappingURL=auth.decorators.js.map