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
exports.KnowledgeService = void 0;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
const tenant_context_store_1 = require("../common/tenant/tenant-context.store");
const knowledge_retriever_1 = require("../knowledge/knowledge-retriever");
let KnowledgeService = class KnowledgeService {
    retriever;
    constructor(retriever) {
        this.retriever = retriever;
    }
    search(query, context) {
        if (context && (0, uuid_1.isUuidv7)(context.tenantId))
            return this.searchTenantKnowledge(query, context.tenantId);
        return this.searchDemo(query);
    }
    async searchTenantKnowledge(query, tenantId) {
        if (!this.retriever || tenant_context_store_1.tenantContextStore.get()?.tenantId !== tenantId) {
            throw new Error('Tenant knowledge is unavailable.');
        }
        const hits = await this.retriever.search({ query, limit: 5 });
        return hits.map((hit) => ({
            id: `${hit.kind}:${hit.sourceId}`,
            title: hit.category ? `${hit.title} (${hit.category})` : hit.title,
            content: `${hit.excerpt}\n[language: ${hit.language}]`,
            source: hit.source,
        }));
    }
    documents = [
        {
            id: 'plan-001',
            title: 'Example earning plan',
            content: 'This is demonstration data only. Replace it with the client application’s actual earning plan, eligibility requirements, benefits, conditions, and disclosures.',
            source: 'demo://earning-plan',
        },
        {
            id: 'product-001',
            title: 'Example product information',
            content: 'This is demonstration data only. Replace it with the actual product description, features, price, availability, and specifications.',
            source: 'demo://product',
        },
    ];
    searchDemo(query) {
        const normalize = (value) => value
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((word) => word.length > 2);
        const terms = normalize(query);
        if (terms.length === 0) {
            return [];
        }
        const scored = this.documents.map((document) => {
            const titleTerms = normalize(document.title);
            const contentTerms = normalize(document.content);
            const score = terms.reduce((total, term) => {
                const inTitle = titleTerms.includes(term);
                const inContent = contentTerms.includes(term);
                return total + (inTitle ? 3 : inContent ? 1 : 0);
            }, 0);
            return { document, score };
        });
        return scored
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((item) => item.document);
    }
};
exports.KnowledgeService = KnowledgeService;
exports.KnowledgeService = KnowledgeService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, common_1.Inject)(knowledge_retriever_1.KNOWLEDGE_RETRIEVER)),
    __metadata("design:paramtypes", [Object])
], KnowledgeService);
//# sourceMappingURL=knowledge.service.js.map