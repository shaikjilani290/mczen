"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentModule = void 0;
const common_1 = require("@nestjs/common");
const agent_controller_1 = require("./agent.controller");
const agent_service_1 = require("./agent.service");
const agent_runtime_config_service_1 = require("./config/agent-runtime-config.service");
const tenant_context_service_1 = require("./context/tenant-context.service");
const tool_audit_service_1 = require("./tools/tool-audit.service");
const tool_executor_service_1 = require("./tools/tool-executor.service");
const tools_module_1 = require("../tools/tools.module");
const conversations_module_1 = require("../conversations/conversations.module");
const website_data_module_1 = require("../website-integrations/website-data.module");
let AgentModule = class AgentModule {
};
exports.AgentModule = AgentModule;
exports.AgentModule = AgentModule = __decorate([
    (0, common_1.Module)({
        imports: [tools_module_1.ToolsModule, conversations_module_1.ConversationsModule, website_data_module_1.WebsiteDataModule],
        controllers: [agent_controller_1.AgentController],
        providers: [
            agent_service_1.AgentService,
            agent_runtime_config_service_1.AgentRuntimeConfigService,
            tenant_context_service_1.TenantContextService,
            tool_executor_service_1.ToolExecutorService,
            tool_audit_service_1.ToolAuditService,
        ],
        exports: [agent_service_1.AgentService, tenant_context_service_1.TenantContextService],
    })
], AgentModule);
//# sourceMappingURL=agent.module.js.map