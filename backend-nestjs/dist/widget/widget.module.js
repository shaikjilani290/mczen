"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WidgetModule = void 0;
const common_1 = require("@nestjs/common");
const agent_module_1 = require("../agent/agent.module");
const voice_module_1 = require("../voice/voice.module");
const widget_controllers_1 = require("./widget.controllers");
const widget_repository_1 = require("./widget.repository");
const widget_service_1 = require("./widget.service");
const website_data_module_1 = require("../website-integrations/website-data.module");
let WidgetModule = class WidgetModule {
};
exports.WidgetModule = WidgetModule;
exports.WidgetModule = WidgetModule = __decorate([
    (0, common_1.Module)({
        imports: [agent_module_1.AgentModule, voice_module_1.VoiceModule, website_data_module_1.WebsiteDataModule],
        controllers: [widget_controllers_1.WidgetAdminController, widget_controllers_1.WidgetPublicController, widget_controllers_1.PlatformController],
        providers: [widget_repository_1.WidgetRepository, widget_service_1.WidgetService],
        exports: [widget_service_1.WidgetService],
    })
], WidgetModule);
//# sourceMappingURL=widget.module.js.map