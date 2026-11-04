import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { binaryToUuid, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { DocumentMetaInput, DocumentQuery } from './knowledge.dto';
import { DocumentStorage } from './document-storage';
import {
  ExtractionError, extractText, PdfJsTextExtractor, validateUpload,
} from './document-extractor';
import type { PdfTextExtractor, UploadedFileLike } from './document-extractor';
import { KnowledgeRepository, Row } from './knowledge.repository';
import { chunkText } from './text-utils';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);

const ERROR_MESSAGES: Record<string, string> = {
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

/** Never includes storage_key or any filesystem location. */
export function toDocument(r: Row) {
  const code = (r.error_code as string | null) ?? null;
  return {
    id: binaryToUuid(r.id as Uint8Array), title: r.title, filename: r.original_filename, fileType: r.file_type,
    byteSize: Number(r.byte_size), language: r.language_code, status: r.status, publication: r.publication,
    categoryId: binaryToUuid(r.category_id as Uint8Array), categoryName: r.category_name,
    chunkCount: Number(r.chunk_count), charCount: Number(r.char_count), sourceName: r.source_name ?? null,
    errorCode: code, errorMessage: code ? (ERROR_MESSAGES[code] ?? ERROR_MESSAGES.PROCESSING_ERROR) : null,
    createdBy: r.created_by ? binaryToUuid(r.created_by as Uint8Array) : null,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), processedAt: iso(r.processed_at),
  };
}

export const PDF_EXTRACTOR = Symbol('PDF_EXTRACTOR');

@Injectable()
export class KnowledgeDocumentsService {
  private readonly logger = new Logger(KnowledgeDocumentsService.name);
  private readonly pdf: PdfTextExtractor;

  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly storage: DocumentStorage,
    @Optional() @Inject(PDF_EXTRACTOR) pdf?: PdfTextExtractor,
  ) {
    this.pdf = pdf ?? new PdfJsTextExtractor();
  }

  async upload(file: UploadedFileLike | undefined, meta: DocumentMetaInput, userId: string) {
    const { fileType, displayName } = validateUpload(file);
    const buffer = (file as UploadedFileLike).buffer;
    await this.repo.ensureDefaultCategories();
    await this.repo.findCategory(meta.categoryId as string);

    const tenantId = this.repo.tenantIdString();
    const id = newUuidv7();
    const storageKey = `${tenantId}/${id}-${randomBytes(4).toString('hex')}`;
    const title = meta.title ?? displayName.replace(/\.[^.]+$/, '').slice(0, 200) ?? displayName;
    await this.storage.put(storageKey, buffer);
    try {
      await this.repo.insertDocument({
        id: uuidToBinary(id), categoryId: uuidToBinary(meta.categoryId as string), title: title || displayName, filename: displayName,
        fileType, byteSize: buffer.length, hash: createHash('sha256').update(buffer).digest('hex'), storageKey,
        language: meta.language ?? 'en', publication: meta.publication ?? 'draft', sourceName: meta.sourceName ?? null, userId: uuidToBinary(userId),
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
    await this.process(id);
    return toDocument(await this.repo.findDocument(id));
  }

  /** Extract → chunk → index. Failures are recorded on the document and never leak internals. */
  private async process(id: string): Promise<void> {
    const binary = uuidToBinary(id);
    const doc = await this.repo.findDocument(id);
    await this.repo.updateDocument(binary, { status: 'processing', errorCode: null });
    try {
      const data = await this.storage.get(doc.storage_key as string).catch(() => {
        throw new ExtractionError('STORAGE_ERROR');
      });
      const text = await extractText(doc.file_type as 'pdf' | 'docx' | 'txt', data, this.pdf);
      const chunks = chunkText(text);
      await this.repo.replaceChunks(undefined, { documentId: binary }, chunks, doc.language_code as string);
      await this.repo.updateDocument(binary, { status: 'processed', errorCode: null, chunkCount: chunks.length, charCount: Math.min(text.length, 4_000_000_000) }, ['`processed_at` = CURRENT_TIMESTAMP(3)']);
    } catch (error) {
      const code = error instanceof ExtractionError ? error.code : error instanceof RangeError && error.message === 'TOO_MANY_CHUNKS' ? 'TOO_MANY_CHUNKS' : 'PROCESSING_ERROR';
      if (code === 'PROCESSING_ERROR') this.logger.error(`Document processing failed: ${(error as Error).name}`);
      await this.repo.replaceChunks(undefined, { documentId: binary }, [], doc.language_code as string).catch(() => undefined);
      await this.repo.updateDocument(binary, { status: 'failed', errorCode: code, chunkCount: 0 });
    }
  }

  async list(query: DocumentQuery) {
    await this.repo.ensureDefaultCategories();
    const { rows, total } = await this.repo.listDocuments(query);
    return { items: rows.map(toDocument), page: query.page, pageSize: query.pageSize, total };
  }

  async get(id: string) {
    return toDocument(await this.repo.findDocument(id));
  }

  async update(id: string, meta: DocumentMetaInput, userId: string) {
    const current = await this.repo.findDocument(id);
    if (meta.categoryId) await this.repo.findCategory(meta.categoryId);
    const fields: Record<string, unknown> = { ...meta, updatedBy: uuidToBinary(userId) };
    if (meta.categoryId) fields.categoryId = uuidToBinary(meta.categoryId);
    await this.repo.transaction(async (manager) => {
      await this.repo.updateDocument(current.id as Buffer, fields);
      if (meta.language && meta.language !== current.language_code) {
        await this.repo.setChunkLanguage(manager, { documentId: current.id as Buffer }, meta.language);
      }
    });
    return this.get(id);
  }

  async replaceFile(id: string, file: UploadedFileLike | undefined, userId: string) {
    const current = await this.repo.findDocument(id);
    const { fileType, displayName } = validateUpload(file);
    const buffer = (file as UploadedFileLike).buffer;
    await this.storage.put(current.storage_key as string, buffer);
    await this.repo.updateDocument(current.id as Buffer, {
      originalFilename: displayName, fileType, byteSize: buffer.length, contentHash: createHash('sha256').update(buffer).digest('hex'),
      status: 'pending', updatedBy: uuidToBinary(userId),
    });
    await this.process(id);
    return this.get(id);
  }

  async reprocess(id: string, userId: string) {
    const current = await this.repo.findDocument(id);
    if (current.status === 'processing') throw new ConflictException('The document is already being processed.');
    await this.repo.updateDocument(current.id as Buffer, { updatedBy: uuidToBinary(userId) });
    await this.process(id);
    return this.get(id);
  }

  async archive(id: string, userId: string) {
    const current = await this.repo.findDocument(id);
    await this.repo.replaceChunks(undefined, { documentId: current.id as Buffer }, [], current.language_code as string);
    await this.repo.updateDocument(current.id as Buffer, { status: 'archived', chunkCount: 0, updatedBy: uuidToBinary(userId) });
    return this.get(id);
  }

  /** Tenant-scoped lookup: another tenant's id resolves to 404 before any file access. */
  async download(id: string) {
    const doc = await this.repo.findDocument(id);
    const data = await this.storage.get(doc.storage_key as string).catch(() => undefined);
    if (!data) throw new ConflictException('The stored file is unavailable.');
    return { data, filename: doc.original_filename as string, fileType: doc.file_type as string };
  }
}
