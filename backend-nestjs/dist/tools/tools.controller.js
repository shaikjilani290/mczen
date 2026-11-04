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
exports.ToolsController = void 0;
const common_1 = require("@nestjs/common");
const audit_interceptor_1 = require("../audit/audit.interceptor");
const auth_decorators_1 = require("../auth/auth.decorators");
const tools_service_1 = require("./tools.service");
const tools_dto_1 = require("./tools.dto");
let ToolsController = class ToolsController {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    list() { return this.tools.list(); }
    secretStatus(name) {
        return this.tools.secretStatus((0, tools_dto_1.validateToolReference)(name));
    }
    setSecret(user, name, body) {
        const input = (0, tools_dto_1.parseToolSecret)(body);
        return this.tools.setSecret((0, tools_dto_1.validateToolReference)(name), input.value, input.expiresAt, user);
    }
    clearSecret(name) {
        return this.tools.clearSecret((0, tools_dto_1.validateToolReference)(name));
    }
    get(name) {
        return this.tools.get((0, tools_dto_1.validateToolReference)(name));
    }
    update(user, name, body) {
        return this.tools.update((0, tools_dto_1.validateToolReference)(name), (0, tools_dto_1.parseTenantToolUpdate)(body), user);
    }
    updateAssistant(name, assistantId, body) {
        return this.tools.updateAssistant((0, tools_dto_1.validateToolReference)(name), assistantId, (0, tools_dto_1.parseAssistantToolUpdate)(body));
    }
};
exports.ToolsController = ToolsController;
__decorate([
    (0, common_1.Get)(),
    (0, auth_decorators_1.RequirePermission)('tools:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ToolsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':toolName/tenant-secret'),
    (0, auth_decorators_1.RequirePermission)('tools:read'),
    __param(0, (0, common_1.Param)('toolName')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ToolsController.prototype, "secretStatus", null);
__decorate([
    (0, common_1.Put)(':toolName/tenant-secret'),
    (0, audit_interceptor_1.Audited)({ action: 'tool.secret.set', resourceType: 'tool', idParam: 'toolName' }),
    (0, auth_decorators_1.RequirePermission)('tools:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('toolName')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ToolsController.prototype, "setSecret", null);
__decorate([
    (0, common_1.Delete)(':toolName/tenant-secret'),
    (0, audit_interceptor_1.Audited)({ action: 'tool.secret.clear', resourceType: 'tool', idParam: 'toolName' }),
    (0, common_1.HttpCode)(200),
    (0, auth_decorators_1.RequirePermission)('tools:write'),
    __param(0, (0, common_1.Param)('toolName')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ToolsController.prototype, "clearSecret", null);
__decorate([
    (0, common_1.Get)(':toolName'),
    (0, auth_decorators_1.RequirePermission)('tools:read'),
    __param(0, (0, common_1.Param)('toolName')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ToolsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(':toolName/tenant-config'),
    (0, audit_interceptor_1.Audited)({ action: 'tool.config.update', resourceType: 'tool', idParam: 'toolName', valueFields: ['enabled'] }),
    (0, auth_decorators_1.RequirePermission)('tools:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('toolName')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ToolsController.prototype, "update", null);
__decorate([
    (0, common_1.Put)(':toolName/assistants/:assistantId'),
    (0, audit_interceptor_1.Audited)({ action: 'tool.assistant.update', resourceType: 'tool', idParam: 'toolName', paramFields: ['assistantId'], valueFields: ['enabled'] }),
    (0, auth_decorators_1.RequirePermission)('tools:write'),
    __param(0, (0, common_1.Param)('toolName')),
    __param(1, (0, common_1.Param)('assistantId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ToolsController.prototype, "updateAssistant", null);
exports.ToolsController = ToolsController = __decorate([
    (0, common_1.Controller)('api/tools'),
    __metadata("design:paramtypes", [tools_service_1.ToolsService])
], ToolsController);
//# sourceMappingURL=tools.controller.js.map