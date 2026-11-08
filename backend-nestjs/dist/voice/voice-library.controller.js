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
exports.VoiceLibraryController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const auth_decorators_1 = require("../auth/auth.decorators");
const voice_library_service_1 = require("./voice-library.service");
let VoiceLibraryController = class VoiceLibraryController {
    library;
    constructor(library) {
        this.library = library;
    }
    list() { return this.library.list(); }
    upload(file, body, user) {
        return this.library.create(file, body, user.userId);
    }
    process(id) { return this.library.process(id); }
    setActive(id, body) {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
            !('active' in body) || typeof body.active !== 'boolean')
            throw new common_1.BadRequestException('Only a boolean active field is accepted.');
        return this.library.setActive(id, body.active);
    }
    async preview(id, body, response) {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
            !('text' in body) || typeof body.text !== 'string')
            throw new common_1.BadRequestException('Preview text is required.');
        const audio = await this.library.preview(id, body.text);
        response.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        return new common_1.StreamableFile(audio);
    }
    remove(id) { return this.library.remove(id); }
};
exports.VoiceLibraryController = VoiceLibraryController;
__decorate([
    (0, common_1.Get)(),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], VoiceLibraryController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: voice_library_service_1.MAX_VOICE_UPLOAD, files: 1, fields: 3, parts: 4 } })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, auth_decorators_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], VoiceLibraryController.prototype, "upload", null);
__decorate([
    (0, common_1.Post)(':id/process'),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VoiceLibraryController.prototype, "process", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], VoiceLibraryController.prototype, "setActive", null);
__decorate([
    (0, common_1.Post)(':id/preview'),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], VoiceLibraryController.prototype, "preview", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, auth_decorators_1.RequirePermission)('assistants:write'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VoiceLibraryController.prototype, "remove", null);
exports.VoiceLibraryController = VoiceLibraryController = __decorate([
    (0, common_1.Controller)('api/voice/profiles'),
    __metadata("design:paramtypes", [voice_library_service_1.VoiceLibraryService])
], VoiceLibraryController);
//# sourceMappingURL=voice-library.controller.js.map