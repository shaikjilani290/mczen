"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolsModule = void 0;
const common_1 = require("@nestjs/common");
const knowledge_module_1 = require("../knowledge/knowledge.module");
const knowledge_service_1 = require("../agent/knowledge.service");
const tool_permission_service_1 = require("../agent/tools/tool-permission.service");
const tool_registry_service_1 = require("../agent/tools/tool-registry.service");
const tool_validation_service_1 = require("../agent/tools/tool-validation.service");
const tool_configuration_repository_1 = require("./tool-configuration.repository");
const tool_secret_cipher_1 = require("./tool-secret-cipher");
const tools_controller_1 = require("./tools.controller");
const tools_service_1 = require("./tools.service");
let ToolsModule = class ToolsModule {
};
exports.ToolsModule = ToolsModule;
exports.ToolsModule = ToolsModule = __decorate([
    (0, common_1.Module)({
        imports: [knowledge_module_1.KnowledgeModule],
        controllers: [tools_controller_1.ToolsController],
        providers: [
            knowledge_service_1.KnowledgeService,
            tool_registry_service_1.ToolRegistryService,
            tool_permission_service_1.ToolPermissionService,
            tool_validation_service_1.ToolValidationService,
            tool_configuration_repository_1.ToolConfigurationRepository,
            tool_secret_cipher_1.ToolSecretCipher,
            tools_service_1.ToolsService,
        ],
        exports: [
            knowledge_service_1.KnowledgeService,
            tool_registry_service_1.ToolRegistryService,
            tool_permission_service_1.ToolPermissionService,
            tool_validation_service_1.ToolValidationService,
            tool_configuration_repository_1.ToolConfigurationRepository,
            tool_secret_cipher_1.ToolSecretCipher,
        ],
    })
], ToolsModule);
//# sourceMappingURL=tools.module.js.map