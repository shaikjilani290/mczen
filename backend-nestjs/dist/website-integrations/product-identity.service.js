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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductIdentityService = void 0;
exports.normalizeProductName = normalizeProductName;
exports.productMentions = productMentions;
const common_1 = require("@nestjs/common");
const website_integration_repository_1 = require("./website-integration.repository");
function normalizeProductName(name) {
    return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function productMentions(text, vocabulary) {
    const normalized = ` ${normalizeProductName(text)} `;
    return vocabulary.filter(product => {
        const name = normalizeProductName(product.name);
        return name.length > 0 && normalized.includes(` ${name} `);
    });
}
let ProductIdentityService = class ProductIdentityService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async vocabulary(context) {
        if (!context.merchant || !context.assistantId || !context.permissions.includes('products:read'))
            return [];
        return this.repository.productVocabulary(context.tenantId, context.assistantId, context.merchant.integrationId);
    }
};
exports.ProductIdentityService = ProductIdentityService;
exports.ProductIdentityService = ProductIdentityService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [website_integration_repository_1.WebsiteIntegrationRepository])
], ProductIdentityService);
//# sourceMappingURL=product-identity.service.js.map