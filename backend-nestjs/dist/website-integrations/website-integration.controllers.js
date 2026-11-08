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
exports.WebsiteIngestionController = exports.WebsiteIntegrationPublicController = exports.WebsiteIntegrationAdminController = void 0;
const common_1 = require("@nestjs/common");
const audit_interceptor_1 = require("../audit/audit.interceptor");
const auth_decorators_1 = require("../auth/auth.decorators");
const uuid_1 = require("../common/ids/uuid");
const widget_dto_1 = require("../widget/widget.dto");
const widget_service_1 = require("../widget/widget.service");
const website_integration_dto_1 = require("./website-integration.dto");
const website_integration_service_1 = require("./website-integration.service");
function pagination(query) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const pageSize = query.pageSize === undefined ? 25 : Number(query.pageSize);
    if (!Number.isInteger(page) || page < 1 || page > 100_000 ||
        !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new common_1.BadRequestException('Pagination is invalid.');
    }
    return { page, pageSize };
}
function integrationId(value) {
    if (!(0, uuid_1.isUuidv7)(value))
        throw new common_1.BadRequestException('Integration id is invalid.');
    return value;
}
function bearer(value) {
    return value?.startsWith('Bearer ') ? value.slice(7).trim() : undefined;
}
let WebsiteIntegrationAdminController = class WebsiteIntegrationAdminController {
    service;
    constructor(service) {
        this.service = service;
    }
    list() {
        return this.service.list();
    }
    create(user, body) {
        return this.service.create((0, website_integration_dto_1.parseCreateWebsiteIntegration)(body), user.userId);
    }
    status(id) {
        return this.service.status(integrationId(id));
    }
    pages(id, query) {
        const { page, pageSize } = pagination(query);
        return this.service.pages(integrationId(id), page, pageSize);
    }
    products(id, query) {
        const { page, pageSize } = pagination(query);
        return this.service.products(integrationId(id), page, pageSize);
    }
    knowledge(id, query) {
        const { page, pageSize } = pagination(query);
        return this.service.knowledgeList(integrationId(id), page, pageSize);
    }
    sync(id) {
        return this.service.beginSync(integrationId(id));
    }
    rotateKeys(id) {
        return this.service.rotateKeys(integrationId(id));
    }
    revoke(id) {
        return this.service.revoke(integrationId(id));
    }
};
exports.WebsiteIntegrationAdminController = WebsiteIntegrationAdminController;
__decorate([
    (0, common_1.Get)(),
    (0, auth_decorators_1.RequirePermission)('tenants:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(201),
    (0, audit_interceptor_1.Audited)({ action: 'website_integration.create', resourceType: 'website_integration' }),
    (0, auth_decorators_1.RequirePermission)('tenants:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id/status'),
    (0, auth_decorators_1.RequirePermission)('tenants:read'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "status", null);
__decorate([
    (0, common_1.Get)(':id/pages'),
    (0, auth_decorators_1.RequirePermission)('tenants:read'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "pages", null);
__decorate([
    (0, common_1.Get)(':id/products'),
    (0, auth_decorators_1.RequirePermission)('tenants:read'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "products", null);
__decorate([
    (0, common_1.Get)(':id/knowledge'),
    (0, auth_decorators_1.RequirePermission)('tenants:read'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "knowledge", null);
__decorate([
    (0, common_1.Post)(':id/sync'),
    (0, common_1.HttpCode)(202),
    (0, audit_interceptor_1.Audited)({ action: 'website_integration.sync', resourceType: 'website_integration', idParam: 'id' }),
    (0, auth_decorators_1.RequirePermission)('tenants:write'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "sync", null);
__decorate([
    (0, common_1.Post)(':id/keys/rotate'),
    (0, common_1.HttpCode)(200),
    (0, audit_interceptor_1.Audited)({ action: 'website_integration.keys.rotate', resourceType: 'website_integration', idParam: 'id' }),
    (0, auth_decorators_1.RequirePermission)('tenants:write'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "rotateKeys", null);
__decorate([
    (0, common_1.Post)(':id/revoke'),
    (0, common_1.HttpCode)(200),
    (0, audit_interceptor_1.Audited)({ action: 'website_integration.revoke', resourceType: 'website_integration', idParam: 'id' }),
    (0, auth_decorators_1.RequirePermission)('tenants:write'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationAdminController.prototype, "revoke", null);
exports.WebsiteIntegrationAdminController = WebsiteIntegrationAdminController = __decorate([
    (0, common_1.Controller)('api/website-integrations'),
    __metadata("design:paramtypes", [website_integration_service_1.WebsiteIntegrationService])
], WebsiteIntegrationAdminController);
let WebsiteIntegrationPublicController = class WebsiteIntegrationPublicController {
    widget;
    constructor(widget) {
        this.widget = widget;
    }
    connect(body, origin, request) {
        const input = (0, website_integration_dto_1.parseSiteConnect)(body);
        return this.widget.createSession(input.publicKey, origin, input.language, request.ip ?? request.socket.remoteAddress, input.assistantId);
    }
    message(body, authorization, origin) {
        const input = (0, widget_dto_1.parsePublicMessage)(body);
        return this.widget.ask(bearer(authorization), origin, input.message, input.language, input.requestId);
    }
    voiceTicket(authorization, origin) {
        return this.widget.voiceTicket(bearer(authorization), origin);
    }
    cartPoll(body, authorization, origin) {
        return this.widget.cartBridge(bearer(authorization), origin, body);
    }
    productContext(body, authorization, origin) {
        return this.widget.productContext(bearer(authorization), origin, body);
    }
    cartResult(body, authorization, origin) {
        return this.widget.cartBridge(bearer(authorization), origin, body, true);
    }
};
exports.WebsiteIntegrationPublicController = WebsiteIntegrationPublicController;
__decorate([
    (0, common_1.Post)('connect'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('origin')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationPublicController.prototype, "connect", null);
__decorate([
    (0, common_1.Post)('message'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('authorization')),
    __param(2, (0, common_1.Headers)('origin')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationPublicController.prototype, "message", null);
__decorate([
    (0, common_1.Post)('voice-ticket'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Headers)('origin')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationPublicController.prototype, "voiceTicket", null);
__decorate([
    (0, common_1.Post)('cart/poll'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('authorization')),
    __param(2, (0, common_1.Headers)('origin')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationPublicController.prototype, "cartPoll", null);
__decorate([
    (0, common_1.Post)('product-context'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('authorization')),
    __param(2, (0, common_1.Headers)('origin')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationPublicController.prototype, "productContext", null);
__decorate([
    (0, common_1.Post)('cart/result'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('authorization')),
    __param(2, (0, common_1.Headers)('origin')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIntegrationPublicController.prototype, "cartResult", null);
exports.WebsiteIntegrationPublicController = WebsiteIntegrationPublicController = __decorate([
    (0, common_1.Controller)('api/website-integrations'),
    (0, auth_decorators_1.PublicRoute)(),
    __metadata("design:paramtypes", [widget_service_1.WidgetService])
], WebsiteIntegrationPublicController);
let WebsiteIngestionController = class WebsiteIngestionController {
    service;
    widget;
    constructor(service, widget) {
        this.service = service;
        this.widget = widget;
    }
    ingestPages(authorization, body) {
        return this.service.ingestPages(bearer(authorization), body);
    }
    ingestProducts(authorization, body) {
        return this.service.ingestProducts(bearer(authorization), body);
    }
    ingestBatch(authorization, body) {
        return this.service.ingestBatch(bearer(authorization), body);
    }
    trackPageView(authorization, origin, body) {
        return this.widget.trackWebsitePage(bearer(authorization), origin, body);
    }
};
exports.WebsiteIngestionController = WebsiteIngestionController;
__decorate([
    (0, common_1.Post)('pages'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIngestionController.prototype, "ingestPages", null);
__decorate([
    (0, common_1.Post)('products'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIngestionController.prototype, "ingestProducts", null);
__decorate([
    (0, common_1.Post)('batch'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIngestionController.prototype, "ingestBatch", null);
__decorate([
    (0, common_1.Post)('page-view'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Headers)('origin')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WebsiteIngestionController.prototype, "trackPageView", null);
exports.WebsiteIngestionController = WebsiteIngestionController = __decorate([
    (0, common_1.Controller)('api/website-ingestion'),
    (0, auth_decorators_1.PublicRoute)(),
    __metadata("design:paramtypes", [website_integration_service_1.WebsiteIntegrationService, widget_service_1.WidgetService])
], WebsiteIngestionController);
//# sourceMappingURL=website-integration.controllers.js.map