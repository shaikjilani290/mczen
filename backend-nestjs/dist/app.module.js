"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const readiness_controller_1 = require("./health/readiness.controller");
const audit_module_1 = require("./audit/audit.module");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const agent_module_1 = require("./agent/agent.module");
const database_module_1 = require("./database/database.module");
const auth_module_1 = require("./auth/auth.module");
const assistants_module_1 = require("./assistants/assistants.module");
const knowledge_module_1 = require("./knowledge/knowledge.module");
const voice_module_1 = require("./voice/voice.module");
const widget_module_1 = require("./widget/widget.module");
const shared_state_module_1 = require("./shared-state/shared-state.module");
const website_integrations_module_1 = require("./website-integrations/website-integrations.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [shared_state_module_1.SharedStateModule, audit_module_1.AuditModule, database_module_1.DatabaseModule.forRoot(), agent_module_1.AgentModule, auth_module_1.AuthModule, assistants_module_1.AssistantsModule, knowledge_module_1.KnowledgeModule, voice_module_1.VoiceModule, widget_module_1.WidgetModule, website_integrations_module_1.WebsiteIntegrationsModule],
        controllers: [app_controller_1.AppController, readiness_controller_1.ReadinessController],
        providers: [app_service_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map