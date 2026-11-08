"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteIntegrationsModule = void 0;
const common_1 = require("@nestjs/common");
const knowledge_module_1 = require("../knowledge/knowledge.module");
const shared_state_module_1 = require("../shared-state/shared-state.module");
const widget_module_1 = require("../widget/widget.module");
const tools_module_1 = require("../tools/tools.module");
const website_data_module_1 = require("./website-data.module");
const website_integration_controllers_1 = require("./website-integration.controllers");
const website_integration_service_1 = require("./website-integration.service");
let WebsiteIntegrationsModule = class WebsiteIntegrationsModule {
};
exports.WebsiteIntegrationsModule = WebsiteIntegrationsModule;
exports.WebsiteIntegrationsModule = WebsiteIntegrationsModule = __decorate([
    (0, common_1.Module)({
        imports: [website_data_module_1.WebsiteDataModule, knowledge_module_1.KnowledgeModule, shared_state_module_1.SharedStateModule, widget_module_1.WidgetModule, tools_module_1.ToolsModule],
        controllers: [
            website_integration_controllers_1.WebsiteIntegrationAdminController,
            website_integration_controllers_1.WebsiteIntegrationPublicController,
            website_integration_controllers_1.WebsiteIngestionController,
        ],
        providers: [website_integration_service_1.WebsiteIntegrationService],
        exports: [website_integration_service_1.WebsiteIntegrationService],
    })
], WebsiteIntegrationsModule);
//# sourceMappingURL=website-integrations.module.js.map