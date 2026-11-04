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
var KnowledgeDocumentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeDocumentsService = exports.PDF_EXTRACTOR = void 0;
exports.toDocument = toDocument;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const uuid_1 = require("../common/ids/uuid");
const document_storage_1 = require("./document-storage");
const document_extractor_1 = require("./document-extractor");
const knowledge_repository_1 = require("./knowledge.repository");
const text_utils_1 = require("./text-utils");
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);
const ERROR_MESSAGES = {
    INVALID_ENCODING: 'The text file is not valid UTF-8.',
    CORRUPT_DOCX: 'The DOCX file is damaged or unsupported.',
    CORRUPT_PDF: 'The PDF file is damaged, encrypted or unsupported.',
    TOO_LARGE: 'The document contains too much text.',
    TOO_MANY_PAGES: 'The PDF has too many pages.',
    TOO_MANY_CHUNKS: 'The document is too large to index.',
    NO_TEXT: 'No readable text was found (scanned images are not supported).',
    PDF_ENGINE_UNAVAILABLE: 'PDF processing is unavailable on the server.',
    STORAGE_ERROR: 'The stored file could not be read.',
    PROCESSING_ERROR: 'The document could not be processed.',
};
function toDocument(r) {
    const code = r.error_code ?? null;
    return {
        id: (0, uuid_1.binaryToUuid)(r.id), title: r.title, filename: r.original_filename, fileType: r.file_type,
        byteSize: Number(r.byte_size), language: r.language_code, status: r.status, publication: r.publication,
        categoryId: (0, uuid_1.binaryToUuid)(r.category_id), categoryName: r.category_name,
        chunkCount: Number(r.chunk_count), charCount: Number(r.char_count), sourceName: r.source_name ?? null,
        errorCode: code, errorMessage: code ? (ERROR_MESSAGES[code] ?? ERROR_MESSAGES.PROCESSING_ERROR) : null,
        createdBy: r.created_by ? (0, uuid_1.binaryToUuid)(r.created_by) : null,
        createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), processedAt: iso(r.processed_at),
    };
}
exports.PDF_EXTRACTOR = Symbol('PDF_EXTRACTOR');
let KnowledgeDocumentsService = KnowledgeDocumentsService_1 = class KnowledgeDocumentsService {
    repo;
    storage;
    logger = new common_1.Logger(KnowledgeDocumentsService_1.name);
    pdf;
    constructor(repo, storage, pdf) {
        this.repo = repo;
        this.storage = storage;
        this.pdf = pdf ?? new document_extractor_1.PdfJsTextExtractor();
    }
    async upload(file, meta, userId) {
        const { fileType, displayName } = (0, document_extractor_1.validateUpload)(file);
        const buffer = file.buffer;
        await this.repo.ensureDefaultCategories();
        await this.repo.findCategory(meta.categoryId);
        const tenantId = this.repo.tenantIdString();
        const id = (0, uuid_1.newUuidv7)();
        const storageKey = `${tenantId}/${id}-${(0, node_crypto_1.randomBytes)(4).toString('hex')}`;
        const title = meta.title ?? displayName.replace(/\.[^.]+$/, '').slice(0, 200) ?? displayName;
        await this.storage.put(storageKey, buffer);
        try {
            await this.repo.insertDocument({
                id: (0, uuid_1.uuidToBinary)(id), categoryId: (0, uuid_1.uuidToBinary)(meta.categoryId), title: title || displayName, filename: displayName,
                fileType, byteSize: buffer.length, hash: (0, node_crypto_1.createHash)('sha256').update(buffer).digest('hex'), storageKey,
                language: meta.language ?? 'en', publication: meta.publication ?? 'draft', sourceName: meta.sourceName ?? null, userId: (0, uuid_1.uuidToBinary)(userId),
            });
        }
        catch (error) {
            await this.storage.delete(storageKey).catch(() => undefined);
            throw error;
        }
        await this.process(id);
        return toDocument(await this.repo.findDocument(id));
    }
    async process(id) {
        const binary = (0, uuid_1.uuidToBinary)(id);
        const doc = await this.repo.findDocument(id);
        await this.repo.updateDocument(binary, { status: 'processing', errorCode: null });
        try {
            const data = await this.storage.get(doc.storage_key).catch(() => {
                throw new document_extractor_1.ExtractionError('STORAGE_ERROR');
            });
            const text = await (0, document_extractor_1.extractText)(doc.file_type, data, this.pdf);
            const chunks = (0, text_utils_1.chunkText)(text);
            await this.repo.replaceChunks(undefined, { documentId: binary }, chunks, doc.language_code);
            await this.repo.updateDocument(binary, { status: 'processed', errorCode: null, chunkCount: chunks.length, charCount: Math.min(text.length, 4_000_000_000) }, ['`processed_at` = CURRENT_TIMESTAMP(3)']);
        }
        catch (error) {
            const code = error instanceof document_extractor_1.ExtractionError ? error.code : error instanceof RangeError && error.message === 'TOO_MANY_CHUNKS' ? 'TOO_MANY_CHUNKS' : 'PROCESSING_ERROR';
            if (code === 'PROCESSING_ERROR')
                this.logger.error(`Document processing failed: ${error.name}`);
            await this.repo.replaceChunks(undefined, { documentId: binary }, [], doc.language_code).catch(() => undefined);
            await this.repo.updateDocument(binary, { status: 'failed', errorCode: code, chunkCount: 0 });
        }
    }
    async list(query) {
        await this.repo.ensureDefaultCategories();
        const { rows, total } = await this.repo.listDocuments(query);
        return { items: rows.map(toDocument), page: query.page, pageSize: query.pageSize, total };
    }
    async get(id) {
        return toDocument(await this.repo.findDocument(id));
    }
    async update(id, meta, userId) {
        const current = await this.repo.findDocument(id);
        if (meta.categoryId)
            await this.repo.findCategory(meta.categoryId);
        const fields = { ...meta, updatedBy: (0, uuid_1.uuidToBinary)(userId) };
        if (meta.categoryId)
            fields.categoryId = (0, uuid_1.uuidToBinary)(meta.categoryId);
        await this.repo.transaction(async (manager) => {
            await this.repo.updateDocument(current.id, fields);
            if (meta.language && meta.language !== current.language_code) {
                await this.repo.setChunkLanguage(manager, { documentId: current.id }, meta.language);
            }
        });
        return this.get(id);
    }
    async replaceFile(id, file, userId) {
        const current = await this.repo.findDocument(id);
        const { fileType, displayName } = (0, document_extractor_1.validateUpload)(file);
        const buffer = file.buffer;
        await this.storage.put(current.storage_key, buffer);
        await this.repo.updateDocument(current.id, {
            originalFilename: displayName, fileType, byteSize: buffer.length, contentHash: (0, node_crypto_1.createHash)('sha256').update(buffer).digest('hex'),
            status: 'pending', updatedBy: (0, uuid_1.uuidToBinary)(userId),
        });
        await this.process(id);
        return this.get(id);
    }
    async reprocess(id, userId) {
        const current = await this.repo.findDocument(id);
        if (current.status === 'processing')
            throw new common_1.ConflictException('The document is already being processed.');
        await this.repo.updateDocument(current.id, { updatedBy: (0, uuid_1.uuidToBinary)(userId) });
        await this.process(id);
        return this.get(id);
    }
    async archive(id, userId) {
        const current = await this.repo.findDocument(id);
        await this.repo.replaceChunks(undefined, { documentId: current.id }, [], current.language_code);
        await this.repo.updateDocument(current.id, { status: 'archived', chunkCount: 0, updatedBy: (0, uuid_1.uuidToBinary)(userId) });
        return this.get(id);
    }
    async download(id) {
        const doc = await this.repo.findDocument(id);
        const data = await this.storage.get(doc.storage_key).catch(() => undefined);
        if (!data)
            throw new common_1.ConflictException('The stored file is unavailable.');
        return { data, filename: doc.original_filename, fileType: doc.file_type };
    }
};
exports.KnowledgeDocumentsService = KnowledgeDocumentsService;
exports.KnowledgeDocumentsService = KnowledgeDocumentsService = KnowledgeDocumentsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Optional)()),
    __param(2, (0, common_1.Inject)(exports.PDF_EXTRACTOR)),
    __metadata("design:paramtypes", [knowledge_repository_1.KnowledgeRepository,
        document_storage_1.DocumentStorage, Object])
], KnowledgeDocumentsService);
//# sourceMappingURL=knowledge-documents.service.js.map