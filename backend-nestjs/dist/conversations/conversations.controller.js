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
exports.ConversationsController = void 0;
const common_1 = require("@nestjs/common");
const auth_decorators_1 = require("../auth/auth.decorators");
const conversations_dto_1 = require("./conversations.dto");
const conversations_service_1 = require("./conversations.service");
let ConversationsController = class ConversationsController {
    conversations;
    constructor(conversations) {
        this.conversations = conversations;
    }
    create(body, user) {
        return this.conversations.create({ ...(0, conversations_dto_1.parseCreateConversation)(body), userId: user.userId });
    }
    list(query, user) {
        return this.conversations.list({
            ...(0, conversations_dto_1.parseConversationQuery)(query),
            userId: user.userId,
            elevated: false,
        });
    }
    get(id, user) {
        return this.conversations.get(id, user);
    }
    update(id, body, user) {
        return this.conversations.update(id, (0, conversations_dto_1.parseUpdateConversation)(body), user);
    }
    async archive(id, user) {
        await this.conversations.archive(id, user);
        return { success: true };
    }
    transcript(id, query, user) {
        return this.conversations.transcript(id, (0, conversations_dto_1.parseTranscriptQuery)(query), user);
    }
    toolCalls(id, messageId, user) {
        return this.conversations.toolCalls(id, messageId, user);
    }
};
exports.ConversationsController = ConversationsController;
__decorate([
    (0, common_1.Post)(),
    (0, auth_decorators_1.RequirePermission)('conversations:write'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ConversationsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, auth_decorators_1.RequirePermission)('conversations:read'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ConversationsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, auth_decorators_1.RequirePermission)('conversations:read'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ConversationsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, auth_decorators_1.RequirePermission)('conversations:write'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], ConversationsController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/archive'),
    (0, auth_decorators_1.RequirePermission)('conversations:write'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "archive", null);
__decorate([
    (0, common_1.Get)(':id/messages'),
    (0, auth_decorators_1.RequirePermission)('conversations:read'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], ConversationsController.prototype, "transcript", null);
__decorate([
    (0, common_1.Get)(':id/messages/:messageId/tool-calls'),
    (0, auth_decorators_1.RequirePermission)('conversations:read'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('messageId')),
    __param(2, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ConversationsController.prototype, "toolCalls", null);
exports.ConversationsController = ConversationsController = __decorate([
    (0, common_1.Controller)('api/conversations'),
    __metadata("design:paramtypes", [conversations_service_1.ConversationsService])
], ConversationsController);
//# sourceMappingURL=conversations.controller.js.map