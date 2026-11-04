"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantContextService = exports.DEV_TENANT_HEADER = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const tenant_context_store_1 = require("../../common/tenant/tenant-context.store");
const loopback_1 = require("../../auth/loopback");
exports.DEV_TENANT_HEADER = 'x-mczen-tenant-id';
const DEV_TENANT_IDS = [
    'tenant-a',
    'tenant-b',
    'tenant-c',
    'tenant-d',
];
const DEV_TENANT_PERMISSIONS = {
    'tenant-a': [
        'knowledge:read',
        'products:read',
        'products:write',
        'orders:read',
        'inventory:read',
    ],
    'tenant-b': [
        'knowledge:read',
        'school:read',
        'school:write',
        'products:read',
        'inventory:read',
    ],
    'tenant-c': ['knowledge:read', 'matrimonial:read'],
    'tenant-d': ['knowledge:read'],
};
let TenantContextService = class TenantContextService {
    resolve() {
        const context = tenant_context_store_1.tenantContextStore.getOrThrow();
        if (!context.requestId)
            throw new Error('The verified request context has no request identifier.');
        return Object.freeze({ tenantId: context.tenantId, userId: context.userId, assistantId: context.assistantId,
            permissions: context.permissions, requestId: context.requestId });
    }
    resolveDevelopment(headers, remoteAddress, requestId = (0, node_crypto_1.randomUUID)()) {
        if (this.isProduction() || process.env.MCZEN_ALLOW_DEV_HEADER !== '1' || !(0, loopback_1.isDirectLoopback)(headers, remoteAddress)) {
            throw new common_1.UnauthorizedException('Authentication required.');
        }
        const raw = headers[exports.DEV_TENANT_HEADER];
        const tenantId = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
        if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
            throw new common_1.UnauthorizedException('Authentication required.');
        }
        const normalized = tenantId.trim();
        if (!DEV_TENANT_IDS.includes(normalized)) {
            throw new common_1.UnauthorizedException('Authentication required.');
        }
        return Object.freeze({
            tenantId: normalized,
            permissions: Object.freeze([...(DEV_TENANT_PERMISSIONS[normalized] ?? [])]),
            requestId,
        });
    }
    isProduction() {
        return process.env['NODE_ENV'] === 'production';
    }
};
exports.TenantContextService = TenantContextService;
exports.TenantContextService = TenantContextService = __decorate([
    (0, common_1.Injectable)()
], TenantContextService);
//# sourceMappingURL=tenant-context.service.js.map