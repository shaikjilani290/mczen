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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformAuditController = exports.AuditController = void 0;
const common_1 = require("@nestjs/common");
const auth_decorators_1 = require("../auth/auth.decorators");
const auth_decorators_2 = require("../auth/auth.decorators");
const uuid_1 = require("../common/ids/uuid");
const audit_service_1 = require("./audit.service");
const ACTION = /^[a-z][a-z0-9_.]{0,79}$/;
function parseQuery(query) {
    const allowed = new Set(['action', 'actorId', 'from', 'to', 'beforeId', 'limit', 'tenantId']);
    for (const key of Object.keys(query))
        if (!allowed.has(key))
            throw new common_1.BadRequestException(`Unknown query parameter: ${key.slice(0, 40)}.`);
    const out = { limit: 50 };
    if (query.action !== undefined) {
        if (typeof query.action !== 'string' || !ACTION.test(query.action))
            throw new common_1.BadRequestException('action is invalid.');
        out.action = query.action;
    }
    if (query.actorId !== undefined) {
        if (typeof query.actorId !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(query.actorId))
            throw new common_1.BadRequestException('actorId is invalid.');
        out.actorId = query.actorId;
    }
    for (const field of ['from', 'to']) {
        const value = query[field];
        if (value === undefined)
            continue;
        const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
        if (Number.isNaN(date.getTime()))
            throw new common_1.BadRequestException(`${field} must be an ISO date.`);
        out[field] = date;
    }
    if (query.beforeId !== undefined) {
        if (typeof query.beforeId !== 'string' || !/^\d{1,19}$/.test(query.beforeId))
            throw new common_1.BadRequestException('beforeId is invalid.');
        out.beforeId = query.beforeId;
    }
    if (query.limit !== undefined) {
        const limit = Number(query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            throw new common_1.BadRequestException('limit must be 1-100.');
        out.limit = limit;
    }
    return out;
}
let AuditController = class AuditController {
    audit;
    constructor(audit) {
        this.audit = audit;
    }
    list(tenant, query) {
        if ('tenantId' in query)
            throw new common_1.BadRequestException('Unknown query parameter: tenantId.');
        return this.audit.list({ ...parseQuery(query), scope: 'tenant', tenantId: tenant.tenantId });
    }
};
exports.AuditController = AuditController;
__decorate([
    (0, common_1.Get)(),
    (0, auth_decorators_1.RequirePermission)('tenants:write'),
    __param(0, (0, auth_decorators_2.CurrentTenant)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AuditController.prototype, "list", null);
exports.AuditController = AuditController = __decorate([
    (0, common_1.Controller)('api/audit'),
    __metadata("design:paramtypes", [audit_service_1.AuditService])
], AuditController);
let PlatformAuditController = class PlatformAuditController {
    audit;
    constructor(audit) {
        this.audit = audit;
    }
    list(query) {
        const parsed = parseQuery(query);
        const tenantId = query.tenantId;
        if (tenantId !== undefined && !(0, uuid_1.isUuidv7)(tenantId))
            throw new common_1.BadRequestException('tenantId is invalid.');
        return this.audit.list({ ...parsed, scope: 'platform', ...(tenantId ? { tenantId: tenantId } : {}) });
    }
};
exports.PlatformAuditController = PlatformAuditController;
__decorate([
    (0, common_1.Get)(),
    (0, auth_decorators_1.RequirePlatform)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PlatformAuditController.prototype, "list", null);
exports.PlatformAuditController = PlatformAuditController = __decorate([
    (0, common_1.Controller)('api/platform/audit'),
    __metadata("design:paramtypes", [audit_service_1.AuditService])
], PlatformAuditController);
//# sourceMappingURL=audit.controller.js.map