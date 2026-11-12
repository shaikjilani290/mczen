"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteDataModule = void 0;
const common_1 = require("@nestjs/common");
const website_integration_repository_1 = require("./website-integration.repository");
const merchant_cart_service_1 = require("./merchant-cart.service");
const shared_state_module_1 = require("../shared-state/shared-state.module");
const product_identity_service_1 = require("./product-identity.service");
const website_knowledge_engine_1 = require("./website-knowledge.engine");
let WebsiteDataModule = class WebsiteDataModule {
};
exports.WebsiteDataModule = WebsiteDataModule;
exports.WebsiteDataModule = WebsiteDataModule = __decorate([
    (0, common_1.Module)({
        imports: [shared_state_module_1.SharedStateModule],
        providers: [website_integration_repository_1.WebsiteIntegrationRepository, merchant_cart_service_1.MerchantCartService, product_identity_service_1.ProductIdentityService, website_knowledge_engine_1.WebsiteKnowledgeEngine],
        exports: [website_integration_repository_1.WebsiteIntegrationRepository, merchant_cart_service_1.MerchantCartService, product_identity_service_1.ProductIdentityService, website_knowledge_engine_1.WebsiteKnowledgeEngine],
    })
], WebsiteDataModule);
//# sourceMappingURL=website-data.module.js.map