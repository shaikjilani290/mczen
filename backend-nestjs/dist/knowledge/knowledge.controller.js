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
exports.KnowledgeController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const auth_decorators_1 = require("../auth/auth.decorators");
const knowledge_content_service_1 = require("./knowledge-content.service");
const knowledge_documents_service_1 = require("./knowledge-documents.service");
const document_extractor_1 = require("./document-extractor");
const knowledge_dto_1 = require("./knowledge.dto");
const UPLOAD = (0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: document_extractor_1.MAX_UPLOAD_BYTES, files: 1, fields: 10, parts: 12 } });
const CONTENT_TYPES = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain; charset=utf-8',
};
let KnowledgeController = class KnowledgeController {
    content;
    documents;
    constructor(content, documents) {
        this.content = content;
        this.documents = documents;
    }
    dashboard() { return this.content.dashboard(); }
    search(query) { return this.content.search((0, knowledge_dto_1.parseSearchQuery)(query)); }
    categories() { return this.content.listCategories(); }
    createCategory(body) { return this.content.createCategory((0, knowledge_dto_1.parseCategory)(body)); }
    updateCategory(id, body) { return this.content.updateCategory(id, (0, knowledge_dto_1.parseCategory)(body, true)); }
    deleteCategory(id) { return this.content.deleteCategory(id); }
    listArticles(query) { return this.content.listArticles((0, knowledge_dto_1.parseArticleQuery)(query)); }
    createArticle(user, body) {
        return this.content.createArticle((0, knowledge_dto_1.parseArticle)(body), user.userId);
    }
    getArticle(id) { return this.content.getArticle(id); }
    updateArticle(user, id, body) {
        return this.content.updateArticle(id, (0, knowledge_dto_1.parseArticle)(body, true), user.userId);
    }
    archiveArticle(user, id) {
        return this.content.archiveArticle(id, user.userId);
    }
    listDocuments(query) { return this.documents.list((0, knowledge_dto_1.parseDocumentQuery)(query)); }
    upload(user, file, body) {
        return this.documents.upload(file, (0, knowledge_dto_1.parseDocumentMeta)(body), user.userId);
    }
    getDocument(id) { return this.documents.get(id); }
    updateDocument(user, id, body) {
        return this.documents.update(id, (0, knowledge_dto_1.parseDocumentMeta)(body, true), user.userId);
    }
    replaceFile(user, id, file) {
        return this.documents.replaceFile(id, file, user.userId);
    }
    reprocess(user, id) { return this.documents.reprocess(id, user.userId); }
    archiveDocument(user, id) { return this.documents.archive(id, user.userId); }
    async download(id, res) {
        const { data, filename, fileType } = await this.documents.download(id);
        res.set({
            'Content-Type': CONTENT_TYPES[fileType] ?? 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-store',
        });
        return new common_1.StreamableFile(data);
    }
};
exports.KnowledgeController = KnowledgeController;
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, auth_decorators_1.RequirePermission)('knowledge:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "dashboard", null);
__decorate([
    (0, common_1.Get)('search'),
    (0, auth_decorators_1.RequirePermission)('knowledge:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('categories'),
    (0, auth_decorators_1.RequirePermission)('knowledge:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "categories", null);
__decorate([
    (0, common_1.Post)('categories'),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "createCategory", null);
__decorate([
    (0, common_1.Patch)('categories/:id'),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "updateCategory", null);
__decorate([
    (0, common_1.Delete)('categories/:id'),
    (0, common_1.HttpCode)(200),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "deleteCategory", null);
__decorate([
    (0, common_1.Get)('articles'),
    (0, auth_decorators_1.RequirePermission)('knowledge:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "listArticles", null);
__decorate([
    (0, common_1.Post)('articles'),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "createArticle", null);
__decorate([
    (0, common_1.Get)('articles/:id'),
    (0, auth_decorators_1.RequirePermission)('knowledge:read'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "getArticle", null);
__decorate([
    (0, common_1.Patch)('articles/:id'),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "updateArticle", null);
__decorate([
    (0, common_1.Post)('articles/:id/archive'),
    (0, common_1.HttpCode)(200),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "archiveArticle", null);
__decorate([
    (0, common_1.Get)('documents'),
    (0, auth_decorators_1.RequirePermission)('knowledge:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "listDocuments", null);
__decorate([
    (0, common_1.Post)('documents'),
    (0, common_1.UseInterceptors)(UPLOAD),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)('documents/:id'),
    (0, auth_decorators_1.RequirePermission)('knowledge:read'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "getDocument", null);
__decorate([
    (0, common_1.Patch)('documents/:id'),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "updateDocument", null);
__decorate([
    (0, common_1.Put)('documents/:id/file'),
    (0, common_1.UseInterceptors)(UPLOAD),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "replaceFile", null);
__decorate([
    (0, common_1.Post)('documents/:id/reprocess'),
    (0, common_1.HttpCode)(200),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "reprocess", null);
__decorate([
    (0, common_1.Post)('documents/:id/archive'),
    (0, common_1.HttpCode)(200),
    (0, auth_decorators_1.RequirePermission)('knowledge:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], KnowledgeController.prototype, "archiveDocument", null);
__decorate([
    (0, common_1.Get)('documents/:id/download'),
    (0, auth_decorators_1.RequirePermission)('knowledge:read'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], KnowledgeController.prototype, "download", null);
exports.KnowledgeController = KnowledgeController = __decorate([
    (0, common_1.Controller)('api/knowledge'),
    __metadata("design:paramtypes", [knowledge_content_service_1.KnowledgeContentService, knowledge_documents_service_1.KnowledgeDocumentsService])
], KnowledgeController);
//# sourceMappingURL=knowledge.controller.js.map