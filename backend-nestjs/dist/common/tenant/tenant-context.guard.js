"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const node_crypto_1 = require("node:crypto");
const auth_store_service_1 = require("../../auth/auth-store.service");
const auth_service_1 = require("../../auth/auth.service");
const token_service_1 = require("../../auth/token.service");
const rate_limit_service_1 = require("../../auth/rate-limit.service");
const auth_context_1 = require("../../auth/auth-context");
const auth_decorators_1 = require("../../auth/auth.decorators");
const tenant_context_service_1 = require("../../agent/context/tenant-context.service");
let TenantAuthGuard = class TenantAuthGuard {
    reflector;
    tokens;
    store;
    rate;
    legacyContext;
    constructor(reflector, tokens, store, rate, legacyContext) {
        this.reflector = reflector;
        this.tokens = tokens;
        this.store = store;
        this.rate = rate;
        this.legacyContext = legacyContext;
    }
    async canActivate(execution) {
        const http = execution.switchToHttp();
        const request = http.getRequest();
        const response = http.getResponse();
        const requestId = (0, node_crypto_1.randomUUID)();
        Object.defineProperty(request, auth_context_1.REQUEST_ID, { value: requestId });
        response.setHeader('X-Request-Id', requestId);
        response.setHeader('Cache-Control', 'no-store');
        const targets = [execution.getHandler(), execution.getClass()];
        const mode = this.reflector.getAllAndOverride(auth_decorators_1.AUTH_MODE, targets) ?? 'tenant';
        const required = this.reflector.getAllAndMerge(auth_decorators_1.REQUIRED_PERMISSIONS, targets) ?? [];
        const policy = this.reflector.getAllAndOverride(auth_decorators_1.AUTH_RATE_POLICY, targets);
        this.rate.checkRequest(request, response, policy);
        if (mode === 'public') {
            if (required.length)
                throw new Error('A public route cannot require permissions.');
            return true;
        }
        if (!['identity', 'tenant', 'platform'].includes(mode))
            throw unauthorized();
        const authorization = request.headers.authorization;
        if (authorization === undefined && mode === 'tenant' && this.reflector.getAllAndOverride(auth_decorators_1.DEV_HEADER_ALLOWED, targets)) {
            const legacy = this.legacyContext.resolveDevelopment(request.headers, request.socket.remoteAddress, requestId);
            const tenant = { ...legacy, actorType: 'system' };
            this.checkPermissions(required, tenant.permissions);
            this.rate.checkContext(response, undefined, tenant);
            (0, auth_context_1.attachContext)(request, undefined, tenant);
            return true;
        }
        if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._-]{1,2048}$/i.test(authorization))
            throw unauthorized();
        const result = this.tokens.verify(authorization.slice(7));
        if (!result.ok)
            throw unauthorized();
        const claims = result.claims;
        const user = await this.store.findUserById(claims.userId);
        const session = await this.store.findSession(claims.sessionId);
        if (!session || !(0, auth_service_1.live)(user, session))
            throw unauthorized();
        if (claims.tenantId !== session.activeTenantId)
            throw new common_1.ConflictException('The access token is stale. Refresh it and retry.');
        let identity = { userId: user.id, sessionId: session.id, activeTenantId: session.activeTenantId };
        let tenant;
        if (mode === 'tenant') {
            if (!session.activeTenantId)
                throw unauthorized();
            const membership = await this.store.findMembership(user.id, session.activeTenantId);
            if (membership?.status !== 'active')
                throw unauthorized();
            if ((await this.store.findTenant(session.activeTenantId))?.status !== 'active')
                throw new common_1.ForbiddenException('Tenant access is unavailable.');
            tenant = { tenantId: session.activeTenantId, actorType: 'user', userId: user.id,
                permissions: await this.store.rolePermissions(membership.roleId), requestId };
            this.checkPermissions(required, tenant.permissions);
        }
        else if (mode === 'platform') {
            const roleId = await this.store.platformRole(user.id);
            if (roleId === undefined)
                throw new common_1.ForbiddenException('Permission denied.');
            this.checkPermissions(required, await this.store.rolePermissions(roleId));
            identity = { ...identity, platformRole: 'platform:admin' };
        }
        else if (required.length) {
            throw new Error('An identity-only route cannot require tenant permissions.');
        }
        this.rate.checkContext(response, identity, tenant);
        await this.store.touchSession(user.id, session.id);
        (0, auth_context_1.attachContext)(request, identity, tenant);
        return true;
    }
    checkPermissions(required, granted) {
        if (!required.every((permission) => granted.includes(permission)))
            throw new common_1.ForbiddenException('Permission denied.');
    }
};
exports.TenantAuthGuard = TenantAuthGuard;
exports.TenantAuthGuard = TenantAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector, token_service_1.TokenService,
        auth_store_service_1.AuthStore, rate_limit_service_1.RateLimitService,
        tenant_context_service_1.TenantContextService])
], TenantAuthGuard);
function unauthorized() { return new common_1.UnauthorizedException('Authentication required.'); }
//# sourceMappingURL=tenant-context.guard.js.map