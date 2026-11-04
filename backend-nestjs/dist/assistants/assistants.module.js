"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantsModule = void 0;
const common_1 = require("@nestjs/common");
const assistant_repository_1 = require("./assistant.repository");
const assistants_controller_1 = require("./assistants.controller");
const assistants_service_1 = require("./assistants.service");
const secret_cipher_service_1 = require("./secret-cipher.service");
let AssistantsModule = class AssistantsModule {
};
exports.AssistantsModule = AssistantsModule;
exports.AssistantsModule = AssistantsModule = __decorate([
    (0, common_1.Module)({
        controllers: [assistants_controller_1.AssistantsController],
        providers: [assistants_service_1.AssistantsService, assistant_repository_1.AssistantRepository, secret_cipher_service_1.SecretCipher],
    })
], AssistantsModule);
//# sourceMappingURL=assistants.module.js.map