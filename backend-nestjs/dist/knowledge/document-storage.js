"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalDocumentStorage = exports.DocumentStorage = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
class DocumentStorage {
}
exports.DocumentStorage = DocumentStorage;
const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f]{8}$/;
let LocalDocumentStorage = class LocalDocumentStorage extends DocumentStorage {
    root = (0, node_path_1.resolve)(process.env.KNOWLEDGE_STORAGE_DIR || (0, node_path_1.join)(process.cwd(), 'storage', 'knowledge'));
    pathFor(key) {
        if (!KEY_PATTERN.test(key))
            throw new Error('Invalid storage key.');
        const full = (0, node_path_1.resolve)(this.root, key);
        if (!full.startsWith(this.root + node_path_1.sep))
            throw new Error('Invalid storage key.');
        return full;
    }
    async put(key, data) {
        const full = this.pathFor(key);
        await node_fs_1.promises.mkdir((0, node_path_1.resolve)(full, '..'), { recursive: true });
        await node_fs_1.promises.writeFile(full, data, { mode: 0o600 });
    }
    get(key) {
        return node_fs_1.promises.readFile(this.pathFor(key));
    }
    async delete(key) {
        await node_fs_1.promises.rm(this.pathFor(key), { force: true });
    }
};
exports.LocalDocumentStorage = LocalDocumentStorage;
exports.LocalDocumentStorage = LocalDocumentStorage = __decorate([
    (0, common_1.Injectable)()
], LocalDocumentStorage);
//# sourceMappingURL=document-storage.js.map