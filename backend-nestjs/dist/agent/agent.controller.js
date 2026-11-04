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
exports.AgentController = void 0;
const common_1 = require("@nestjs/common");
const tenant_context_service_1 = require("./context/tenant-context.service");
const auth_decorators_1 = require("../auth/auth.decorators");
const agent_service_1 = require("./agent.service");
const tool_registry_service_1 = require("./tools/tool-registry.service");
const conversations_dto_1 = require("../conversations/conversations.dto");
let AgentController = class AgentController {
    agent;
    toolRegistry;
    tenantContext;
    constructor(agent, toolRegistry, tenantContext) {
        this.agent = agent;
        this.toolRegistry = toolRegistry;
        this.tenantContext = tenantContext;
    }
    async ask(body, response) {
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).some((key) => key !== 'question' && key !== 'conversationId')) {
            throw new common_1.BadRequestException('The request contains unsupported fields.');
        }
        const request = body;
        const question = typeof request.question === 'string' ? request.question.trim() : '';
        if (!question || question.length > 2000) {
            throw new common_1.BadRequestException('Question must contain between 1 and 2000 characters.');
        }
        const context = this.tenantContext.resolve();
        response?.setHeader('X-Request-Id', context.requestId);
        const conversationId = (0, conversations_dto_1.parseAgentConversationId)(request.conversationId);
        return this.agent.ask(question, conversationId ? { ...context, conversationId } : context);
    }
    async getTools(response) {
        const context = this.tenantContext.resolve();
        response?.setHeader('X-Request-Id', context.requestId);
        return {
            success: true,
            tools: (await this.toolRegistry.listForTenantAtCallTime(context.tenantId, context.assistantId))
                .filter((tool) => tool.enabled),
        };
    }
};
exports.AgentController = AgentController;
__decorate([
    (0, common_1.Post)('ask'),
    (0, auth_decorators_1.AllowDevHeader)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "ask", null);
__decorate([
    (0, common_1.Get)('tools'),
    (0, auth_decorators_1.AllowDevHeader)(),
    __param(0, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AgentController.prototype, "getTools", null);
exports.AgentController = AgentController = __decorate([
    (0, common_1.Controller)('api/agent'),
    __metadata("design:paramtypes", [agent_service_1.AgentService,
        tool_registry_service_1.ToolRegistryService,
        tenant_context_service_1.TenantContextService])
], AgentController);
//# sourceMappingURL=agent.controller.js.map