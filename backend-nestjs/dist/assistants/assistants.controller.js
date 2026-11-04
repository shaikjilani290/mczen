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
exports.AssistantsController = void 0;
const common_1 = require("@nestjs/common");
const audit_interceptor_1 = require("../audit/audit.interceptor");
const auth_decorators_1 = require("../auth/auth.decorators");
const assistants_service_1 = require("./assistants.service");
const assistants_dto_1 = require("./assistants.dto");
let AssistantsController = class AssistantsController {
    assistants;
    constructor(assistants) {
        this.assistants = assistants;
    }
    options() { return this.assistants.options(); }
    list() { return this.assistants.list(); }
    create(user, body) {
        return this.assistants.create((0, assistants_dto_1.parseCreateAssistant)(body), user.userId);
    }
    get(id) { return this.assistants.get(id); }
    update(user, id, body) {
        return this.assistants.update(id, (0, assistants_dto_1.parseUpdateAssistant)(body), user.userId);
    }
    instructions(id) { return this.assistants.instructionHistory(id); }
    setInstructions(user, id, body) {
        return this.assistants.setInstructions(id, (0, assistants_dto_1.parseInstructions)(body), user.userId);
    }
    setSecret(user, id, kind, body) {
        return this.assistants.setSecret(id, (0, assistants_dto_1.parseSecretKind)(kind), (0, assistants_dto_1.parseSecretInput)(body), user.userId);
    }
    clearSecret(user, id, kind) {
        return this.assistants.clearSecret(id, (0, assistants_dto_1.parseSecretKind)(kind), user.userId);
    }
    audit(id) { return this.assistants.audit(id); }
};
exports.AssistantsController = AssistantsController;
__decorate([
    (0, common_1.Get)('options'),
    (0, auth_decorators_1.RequirePermission)('assistants:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "options", null);
__decorate([
    (0, common_1.Get)(),
    (0, auth_decorators_1.RequirePermission)('assistants:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, audit_interceptor_1.Audited)({ action: 'assistant.create', resourceType: 'assistant' }),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, auth_decorators_1.RequirePermission)('assistants:read'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, audit_interceptor_1.Audited)({ action: 'assistant.update', resourceType: 'assistant', idParam: 'id' }),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "update", null);
__decorate([
    (0, common_1.Get)(':id/instructions'),
    (0, auth_decorators_1.RequirePermission)('assistants:read'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "instructions", null);
__decorate([
    (0, common_1.Put)(':id/instructions'),
    (0, audit_interceptor_1.Audited)({ action: 'assistant.instructions.update', resourceType: 'assistant', idParam: 'id' }),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "setInstructions", null);
__decorate([
    (0, common_1.Put)(':id/secrets/:kind'),
    (0, audit_interceptor_1.Audited)({ action: 'assistant.secret.set', resourceType: 'assistant', idParam: 'id', paramFields: ['kind'] }),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('kind')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "setSecret", null);
__decorate([
    (0, common_1.Delete)(':id/secrets/:kind'),
    (0, audit_interceptor_1.Audited)({ action: 'assistant.secret.clear', resourceType: 'assistant', idParam: 'id', paramFields: ['kind'] }),
    (0, common_1.HttpCode)(200),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "clearSecret", null);
__decorate([
    (0, common_1.Get)(':id/audit'),
    (0, auth_decorators_1.RequirePermission)('assistants:read'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AssistantsController.prototype, "audit", null);
exports.AssistantsController = AssistantsController = __decorate([
    (0, common_1.Controller)('api/assistants'),
    __metadata("design:paramtypes", [assistants_service_1.AssistantsService])
], AssistantsController);
//# sourceMappingURL=assistants.controller.js.map