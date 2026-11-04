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
exports.PlatformController = exports.WidgetPublicController = exports.WidgetAdminController = void 0;
const common_1 = require("@nestjs/common");
const audit_interceptor_1 = require("../audit/audit.interceptor");
const auth_decorators_1 = require("../auth/auth.decorators");
const uuid_1 = require("../common/ids/uuid");
const widget_dto_1 = require("./widget.dto");
const widget_repository_1 = require("./widget.repository");
const widget_service_1 = require("./widget.service");
let WidgetAdminController = class WidgetAdminController {
    widget;
    constructor(widget) {
        this.widget = widget;
    }
    settings() { return this.widget.getSettings(); }
    update(user, body) {
        return this.widget.updateSettings((0, widget_dto_1.parseWidgetSettingsUpdate)(body), user.userId);
    }
    rotate(user) { return this.widget.rotateKey(user.userId); }
    analytics(query) { return this.widget.analytics((0, widget_dto_1.parseDateRange)(query)); }
};
exports.WidgetAdminController = WidgetAdminController;
__decorate([
    (0, common_1.Get)('settings'),
    (0, auth_decorators_1.RequirePermission)('tenants:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WidgetAdminController.prototype, "settings", null);
__decorate([
    (0, common_1.Patch)('settings'),
    (0, audit_interceptor_1.Audited)({ action: 'widget.settings.update', resourceType: 'widget_settings' }),
    (0, auth_decorators_1.RequirePermission)('tenants:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WidgetAdminController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('settings/rotate-key'),
    (0, audit_interceptor_1.Audited)({ action: 'widget.key.rotate', resourceType: 'widget_settings' }),
    (0, common_1.HttpCode)(200),
    (0, auth_decorators_1.RequirePermission)('tenants:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WidgetAdminController.prototype, "rotate", null);
__decorate([
    (0, common_1.Get)('analytics'),
    (0, auth_decorators_1.RequirePermission)('usage:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WidgetAdminController.prototype, "analytics", null);
exports.WidgetAdminController = WidgetAdminController = __decorate([
    (0, common_1.Controller)('api/widget'),
    __metadata("design:paramtypes", [widget_service_1.WidgetService])
], WidgetAdminController);
let WidgetPublicController = class WidgetPublicController {
    widget;
    constructor(widget) {
        this.widget = widget;
    }
    session(body, origin, request) {
        const input = (0, widget_dto_1.parsePublicSession)(body);
        return this.widget.createSession(input.publicKey, origin, input.language, request.ip ?? request.socket.remoteAddress);
    }
    message(body, authorization, origin) {
        const input = (0, widget_dto_1.parsePublicMessage)(body);
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
        return this.widget.ask(token, origin, input.message, input.language);
    }
    voiceTicket(authorization, origin) {
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
        return this.widget.voiceTicket(token, origin);
    }
};
exports.WidgetPublicController = WidgetPublicController;
__decorate([
    (0, common_1.Post)('session'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('origin')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WidgetPublicController.prototype, "session", null);
__decorate([
    (0, common_1.Post)('message'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('authorization')),
    __param(2, (0, common_1.Headers)('origin')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WidgetPublicController.prototype, "message", null);
__decorate([
    (0, common_1.Post)('voice-ticket'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Headers)('origin')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WidgetPublicController.prototype, "voiceTicket", null);
exports.WidgetPublicController = WidgetPublicController = __decorate([
    (0, common_1.Controller)('api/widget/public'),
    (0, auth_decorators_1.PublicRoute)(),
    __metadata("design:paramtypes", [widget_service_1.WidgetService])
], WidgetPublicController);
let PlatformController = class PlatformController {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    overview() { return this.repository.platformOverview(); }
    tenants(page, pageSize) {
        const p = page === undefined ? 1 : Number(page);
        const size = pageSize === undefined ? 25 : Number(pageSize);
        if (!Number.isInteger(p) || p < 1 || p > 10_000 || !Number.isInteger(size) || size < 1 || size > 100)
            throw new common_1.BadRequestException('Pagination is invalid.');
        return this.repository.platformTenants(p, size);
    }
    async setStatus(user, id, body) {
        if (!(0, uuid_1.isUuidv7)(id))
            throw new common_1.BadRequestException('Tenant id is invalid.');
        const input = (0, widget_dto_1.parseTenantStatus)(body);
        if (!(await this.repository.setTenantStatus(id, input.status, input.reason)))
            throw new common_1.BadRequestException('Tenant status cannot be changed.');
        return { id, status: input.status };
    }
};
exports.PlatformController = PlatformController;
__decorate([
    (0, common_1.Get)('overview'),
    (0, auth_decorators_1.RequirePlatform)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PlatformController.prototype, "overview", null);
__decorate([
    (0, common_1.Get)('tenants'),
    (0, auth_decorators_1.RequirePlatform)(),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('pageSize')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PlatformController.prototype, "tenants", null);
__decorate([
    (0, common_1.Patch)('tenants/:id/status'),
    (0, audit_interceptor_1.Audited)({ action: 'platform.tenant.status', resourceType: 'tenant', scope: 'platform', idParam: 'id', tenantParam: 'id', valueFields: ['status'] }),
    (0, auth_decorators_1.RequirePlatform)(),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], PlatformController.prototype, "setStatus", null);
exports.PlatformController = PlatformController = __decorate([
    (0, common_1.Controller)('api/platform'),
    __metadata("design:paramtypes", [widget_repository_1.WidgetRepository])
], PlatformController);
//# sourceMappingURL=widget.controllers.js.map