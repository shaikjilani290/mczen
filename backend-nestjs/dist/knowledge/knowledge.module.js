"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeModule = void 0;
const common_1 = require("@nestjs/common");
const document_storage_1 = require("./document-storage");
const knowledge_content_service_1 = require("./knowledge-content.service");
const knowledge_documents_service_1 = require("./knowledge-documents.service");
const knowledge_retriever_1 = require("./knowledge-retriever");
const knowledge_controller_1 = require("./knowledge.controller");
const knowledge_repository_1 = require("./knowledge.repository");
let KnowledgeModule = class KnowledgeModule {
};
exports.KnowledgeModule = KnowledgeModule;
exports.KnowledgeModule = KnowledgeModule = __decorate([
    (0, common_1.Module)({
        controllers: [knowledge_controller_1.KnowledgeController],
        providers: [
            knowledge_repository_1.KnowledgeRepository,
            knowledge_content_service_1.KnowledgeContentService,
            knowledge_documents_service_1.KnowledgeDocumentsService,
            knowledge_retriever_1.MysqlKnowledgeRetriever,
            { provide: knowledge_retriever_1.KNOWLEDGE_RETRIEVER, useExisting: knowledge_retriever_1.MysqlKnowledgeRetriever },
            { provide: document_storage_1.DocumentStorage, useClass: document_storage_1.LocalDocumentStorage },
        ],
        exports: [knowledge_retriever_1.KNOWLEDGE_RETRIEVER, knowledge_repository_1.KnowledgeRepository],
    })
], KnowledgeModule);
//# sourceMappingURL=knowledge.module.js.map