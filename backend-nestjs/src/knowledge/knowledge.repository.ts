import { ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { isUuidv7, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { TenantScopedRepository } from '../common/tenant/tenant-scoped.repository';
import { ArticleQuery, DEFAULT_CATEGORIES, DocumentQuery } from './knowledge.dto';

export type Row = Record<string, unknown>;

export interface ChunkParent { articleId?: Buffer; documentId?: Buffer }

export interface RawSearchParams {
  match: string;
  categoryId?: string;
  language?: string;
  limit: number;
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Raw parameterized SQL (the project registers no TypeORM entities). Every
 * statement is scoped by currentTenantId(), which reads the verified ALS
 * context and fails closed; no method accepts a tenant id from callers.
 */
@Injectable()
export class KnowledgeRepository extends TenantScopedRepository<ObjectLiteral> {
  constructor(@Optional() @InjectDataSource() private readonly source?: DataSource) {
    super(undefined as unknown as Repository<ObjectLiteral>);
  }

  private get database(): DataSource {
    if (!this.source) throw new ServiceUnavailableException('Knowledge management is unavailable.');
    return this.source;
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  tenantBinary(): Buffer {
    return uuidToBinary(this.currentTenantId());
  }

  tenantIdString(): string {
    return this.currentTenantId();
  }

  private run(manager: EntityManager | undefined, sql: string, params: unknown[] = []): Promise<Row[]> {
    return (manager ?? this.database).query(sql, params) as Promise<Row[]>;
  }

  /** Malformed or foreign ids are indistinguishable from missing ones. */
  idBinary(id: string, what: string): Buffer {
    if (!isUuidv7(id)) throw new NotFoundException(`${what} not found.`);
    return uuidToBinary(id);
  }

  // ---------- categories ----------

  async ensureDefaultCategories(): Promise<void> {
    const tenant = this.tenantBinary();
    const existing = await this.run(undefined, 'SELECT COUNT(*) AS n FROM `knowledge_categories` WHERE `tenant_id` = ?', [tenant]);
    if (Number(existing[0]?.n) > 0) return;
    for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
      await this.run(
        undefined,
        'INSERT IGNORE INTO `knowledge_categories` (`id`, `tenant_id`, `name`, `slug`, `is_system`, `sort_order`) VALUES (?, ?, ?, ?, 1, ?)',
        [uuidToBinary(newUuidv7()), tenant, category.name, category.slug, index],
      );
    }
  }

  async listCategories(): Promise<Row[]> {
    const tenant = this.tenantBinary();
    return this.run(
      undefined,
      `SELECT c.*,
         (SELECT COUNT(*) FROM \`knowledge_articles\` a WHERE a.\`category_id\` = c.\`id\` AND a.\`tenant_id\` = c.\`tenant_id\` AND a.\`status\` <> 'archived') AS article_count,
         (SELECT COUNT(*) FROM \`knowledge_documents\` d WHERE d.\`category_id\` = c.\`id\` AND d.\`tenant_id\` = c.\`tenant_id\` AND d.\`status\` <> 'archived') AS document_count
       FROM \`knowledge_categories\` c WHERE c.\`tenant_id\` = ? ORDER BY c.\`sort_order\`, c.\`name\``,
      [tenant],
    );
  }

  async findCategory(id: string, manager?: EntityManager): Promise<Row> {
    const rows = await this.run(manager, 'SELECT * FROM `knowledge_categories` WHERE `id` = ? AND `tenant_id` = ?', [this.idBinary(id, 'Category'), this.tenantBinary()]);
    if (!rows[0]) throw new NotFoundException('Category not found.');
    return rows[0];
  }

  async insertCategory(name: string, slug: string, description: string | null): Promise<Buffer> {
    const id = uuidToBinary(newUuidv7());
    const tenant = this.tenantBinary();
    const [{ next }] = (await this.run(undefined, 'SELECT COALESCE(MAX(`sort_order`), 0) + 1 AS next FROM `knowledge_categories` WHERE `tenant_id` = ?', [tenant])) as [{ next: number }];
    try {
      await this.run(undefined, 'INSERT INTO `knowledge_categories` (`id`, `tenant_id`, `name`, `slug`, `description`, `is_system`, `sort_order`) VALUES (?, ?, ?, ?, ?, 0, ?)', [id, tenant, name, slug, description, Math.min(Number(next), 65000)]);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ConflictException('A category with this name already exists.');
      throw error;
    }
    return id;
  }

  async updateCategory(id: string, fields: { name?: string; slug?: string; description?: string | null }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.name !== undefined) { sets.push('`name` = ?', '`slug` = ?'); params.push(fields.name, fields.slug); }
    if (fields.description !== undefined) { sets.push('`description` = ?'); params.push(fields.description); }
    try {
      await this.run(undefined, `UPDATE \`knowledge_categories\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`tenant_id\` = ?`, [...params, this.idBinary(id, 'Category'), this.tenantBinary()]);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ConflictException('A category with this name already exists.');
      throw error;
    }
  }

  async categoryUsage(id: string): Promise<number> {
    const binary = this.idBinary(id, 'Category');
    const tenant = this.tenantBinary();
    const rows = await this.run(
      undefined,
      'SELECT (SELECT COUNT(*) FROM `knowledge_articles` WHERE `category_id` = ? AND `tenant_id` = ?) + (SELECT COUNT(*) FROM `knowledge_documents` WHERE `category_id` = ? AND `tenant_id` = ?) AS n',
      [binary, tenant, binary, tenant],
    );
    return Number(rows[0]?.n);
  }

  async deleteCategory(id: string): Promise<void> {
    await this.run(undefined, 'DELETE FROM `knowledge_categories` WHERE `id` = ? AND `tenant_id` = ? AND `is_system` = 0', [this.idBinary(id, 'Category'), this.tenantBinary()]);
  }

  // ---------- articles ----------

  async insertArticle(manager: EntityManager, a: { id: Buffer; categoryId: Buffer; title: string; summary: string | null; content: string; language: string; status: string; sourceName: string | null; sourceUrl: string | null; referenceNote: string | null; userId: Buffer }): Promise<void> {
    await this.run(
      manager,
      `INSERT INTO \`knowledge_articles\` (\`id\`, \`tenant_id\`, \`category_id\`, \`title\`, \`summary\`, \`content\`, \`language_code\`, \`status\`, \`source_name\`, \`source_url\`, \`reference_note\`, \`created_by\`, \`updated_by\`, \`published_at\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${a.status === 'published' ? 'CURRENT_TIMESTAMP(3)' : 'NULL'})`,
      [a.id, this.tenantBinary(), a.categoryId, a.title, a.summary, a.content, a.language, a.status, a.sourceName, a.sourceUrl, a.referenceNote, a.userId, a.userId],
    );
  }

  async updateArticle(manager: EntityManager, id: Buffer, fields: Record<string, unknown>, publishing: boolean): Promise<void> {
    const columns: Record<string, string> = { categoryId: 'category_id', title: 'title', summary: 'summary', content: 'content', language: 'language_code', status: 'status', sourceName: 'source_name', sourceUrl: 'source_url', referenceNote: 'reference_note', updatedBy: 'updated_by' };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      const column = columns[key];
      if (!column) continue;
      sets.push(`\`${column}\` = ?`);
      params.push(value);
    }
    if (publishing) sets.push('`published_at` = COALESCE(`published_at`, CURRENT_TIMESTAMP(3))');
    if (sets.length === 0) return;
    await this.run(manager, `UPDATE \`knowledge_articles\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`tenant_id\` = ?`, [...params, id, this.tenantBinary()]);
  }

  async findArticle(id: string, manager?: EntityManager, lock = false): Promise<Row> {
    const rows = await this.run(
      manager,
      `SELECT a.*, c.\`name\` AS category_name FROM \`knowledge_articles\` a JOIN \`knowledge_categories\` c ON c.\`id\` = a.\`category_id\` AND c.\`tenant_id\` = a.\`tenant_id\`
       WHERE a.\`id\` = ? AND a.\`tenant_id\` = ?${lock ? ' FOR UPDATE' : ''}`,
      [this.idBinary(id, 'Article'), this.tenantBinary()],
    );
    if (!rows[0]) throw new NotFoundException('Article not found.');
    return rows[0];
  }

  async listArticles(q: ArticleQuery): Promise<{ rows: Row[]; total: number }> {
    const where: string[] = ['a.`tenant_id` = ?'];
    const params: unknown[] = [this.tenantBinary()];
    if (q.status) { where.push('a.`status` = ?'); params.push(q.status); } else where.push("a.`status` <> 'archived'");
    if (q.categoryId) { where.push('a.`category_id` = ?'); params.push(this.idBinary(q.categoryId, 'Category')); }
    if (q.language) { where.push('a.`language_code` = ?'); params.push(q.language); }
    if (q.tag) { where.push('EXISTS (SELECT 1 FROM `knowledge_article_tags` t WHERE t.`article_id` = a.`id` AND t.`tenant_id` = a.`tenant_id` AND t.`tag` = ?)'); params.push(q.tag); }
    if (q.q) { where.push('(a.`title` LIKE ? OR a.`summary` LIKE ?)'); params.push(`%${escapeLike(q.q)}%`, `%${escapeLike(q.q)}%`); }
    const clause = where.join(' AND ');
    const total = Number((await this.run(undefined, `SELECT COUNT(*) AS n FROM \`knowledge_articles\` a WHERE ${clause}`, params))[0]?.n);
    const rows = await this.run(
      undefined,
      `SELECT a.\`id\`, a.\`title\`, a.\`summary\`, a.\`language_code\`, a.\`status\`, a.\`category_id\`, a.\`created_by\`, a.\`updated_by\`, a.\`created_at\`, a.\`updated_at\`, a.\`published_at\`, c.\`name\` AS category_name
       FROM \`knowledge_articles\` a JOIN \`knowledge_categories\` c ON c.\`id\` = a.\`category_id\` AND c.\`tenant_id\` = a.\`tenant_id\`
       WHERE ${clause} ORDER BY a.\`updated_at\` DESC, a.\`id\` LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return { rows, total };
  }

  async tagsFor(articleIds: Buffer[]): Promise<Row[]> {
    if (articleIds.length === 0) return [];
    return this.run(undefined, `SELECT \`article_id\`, \`tag\` FROM \`knowledge_article_tags\` WHERE \`tenant_id\` = ? AND \`article_id\` IN (${articleIds.map(() => '?').join(',')}) ORDER BY \`tag\``, [this.tenantBinary(), ...articleIds]);
  }

  async replaceTags(manager: EntityManager, articleId: Buffer, tags: string[]): Promise<void> {
    const tenant = this.tenantBinary();
    await this.run(manager, 'DELETE FROM `knowledge_article_tags` WHERE `article_id` = ? AND `tenant_id` = ?', [articleId, tenant]);
    for (const tag of tags) {
      await this.run(manager, 'INSERT INTO `knowledge_article_tags` (`article_id`, `tenant_id`, `tag`) VALUES (?, ?, ?)', [articleId, tenant, tag]);
    }
  }

  // ---------- chunks ----------

  async replaceChunks(manager: EntityManager | undefined, parent: ChunkParent, chunks: string[], language: string): Promise<void> {
    const tenant = this.tenantBinary();
    const column = parent.articleId ? 'article_id' : 'document_id';
    const parentId = (parent.articleId ?? parent.documentId) as Buffer;
    await this.run(manager, `DELETE FROM \`knowledge_chunks\` WHERE \`${column}\` = ? AND \`tenant_id\` = ?`, [parentId, tenant]);
    for (let start = 0; start < chunks.length; start += 200) {
      const rows = chunks.slice(start, start + 200).map((content, i) => [
        tenant,
        parent.articleId ?? null,
        parent.documentId ?? null,
        start + i,
        content,
        language,
        Math.min(content.length, 65000),
      ]);
      await this.run(manager, 'INSERT INTO `knowledge_chunks` (`tenant_id`, `article_id`, `document_id`, `chunk_index`, `content`, `language_code`, `char_count`) VALUES ?', [rows]);
    }
  }

  async setChunkLanguage(manager: EntityManager, parent: ChunkParent, language: string): Promise<void> {
    const column = parent.articleId ? 'article_id' : 'document_id';
    await this.run(manager, `UPDATE \`knowledge_chunks\` SET \`language_code\` = ? WHERE \`${column}\` = ? AND \`tenant_id\` = ?`, [language, (parent.articleId ?? parent.documentId) as Buffer, this.tenantBinary()]);
  }

  // ---------- documents ----------

  async insertDocument(d: { id: Buffer; categoryId: Buffer; title: string; filename: string; fileType: string; byteSize: number; hash: string; storageKey: string; language: string; publication: string; sourceName: string | null; userId: Buffer }): Promise<void> {
    await this.run(
      undefined,
      `INSERT INTO \`knowledge_documents\` (\`id\`, \`tenant_id\`, \`category_id\`, \`title\`, \`original_filename\`, \`file_type\`, \`byte_size\`, \`content_hash\`, \`storage_key\`, \`language_code\`, \`publication\`, \`source_name\`, \`created_by\`, \`updated_by\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.id, this.tenantBinary(), d.categoryId, d.title, d.filename, d.fileType, d.byteSize, d.hash, d.storageKey, d.language, d.publication, d.sourceName, d.userId, d.userId],
    );
  }

  async updateDocument(id: Buffer, fields: Record<string, unknown>, rawSets: string[] = []): Promise<void> {
    const columns: Record<string, string> = { categoryId: 'category_id', title: 'title', language: 'language_code', publication: 'publication', sourceName: 'source_name', status: 'status', errorCode: 'error_code', chunkCount: 'chunk_count', charCount: 'char_count', updatedBy: 'updated_by', originalFilename: 'original_filename', fileType: 'file_type', byteSize: 'byte_size', contentHash: 'content_hash' };
    const sets = [...rawSets];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      const column = columns[key];
      if (!column) continue;
      sets.push(`\`${column}\` = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    await this.run(undefined, `UPDATE \`knowledge_documents\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`tenant_id\` = ?`, [...params, id, this.tenantBinary()]);
  }

  async findDocument(id: string): Promise<Row> {
    const rows = await this.run(
      undefined,
      `SELECT d.*, c.\`name\` AS category_name FROM \`knowledge_documents\` d JOIN \`knowledge_categories\` c ON c.\`id\` = d.\`category_id\` AND c.\`tenant_id\` = d.\`tenant_id\`
       WHERE d.\`id\` = ? AND d.\`tenant_id\` = ?`,
      [this.idBinary(id, 'Document'), this.tenantBinary()],
    );
    if (!rows[0]) throw new NotFoundException('Document not found.');
    return rows[0];
  }

  async listDocuments(q: DocumentQuery): Promise<{ rows: Row[]; total: number }> {
    const where: string[] = ['d.`tenant_id` = ?'];
    const params: unknown[] = [this.tenantBinary()];
    if (q.status) { where.push('d.`status` = ?'); params.push(q.status); } else where.push("d.`status` <> 'archived'");
    if (q.categoryId) { where.push('d.`category_id` = ?'); params.push(this.idBinary(q.categoryId, 'Category')); }
    if (q.language) { where.push('d.`language_code` = ?'); params.push(q.language); }
    if (q.q) { where.push('(d.`title` LIKE ? OR d.`original_filename` LIKE ?)'); params.push(`%${escapeLike(q.q)}%`, `%${escapeLike(q.q)}%`); }
    const clause = where.join(' AND ');
    const total = Number((await this.run(undefined, `SELECT COUNT(*) AS n FROM \`knowledge_documents\` d WHERE ${clause}`, params))[0]?.n);
    const rows = await this.run(
      undefined,
      `SELECT d.*, c.\`name\` AS category_name FROM \`knowledge_documents\` d JOIN \`knowledge_categories\` c ON c.\`id\` = d.\`category_id\` AND c.\`tenant_id\` = d.\`tenant_id\`
       WHERE ${clause} ORDER BY d.\`updated_at\` DESC, d.\`id\` LIMIT ? OFFSET ?`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return { rows, total };
  }

  // ---------- dashboard ----------

  async dashboardCounts(): Promise<{ articles: Row[]; documents: Row[]; categories: number; recent: Row[] }> {
    const tenant = this.tenantBinary();
    const articles = await this.run(undefined, 'SELECT `status`, `language_code`, COUNT(*) AS n FROM `knowledge_articles` WHERE `tenant_id` = ? GROUP BY `status`, `language_code`', [tenant]);
    const documents = await this.run(undefined, 'SELECT `status`, COUNT(*) AS n FROM `knowledge_documents` WHERE `tenant_id` = ? GROUP BY `status`', [tenant]);
    const categories = Number((await this.run(undefined, 'SELECT COUNT(*) AS n FROM `knowledge_categories` WHERE `tenant_id` = ?', [tenant]))[0]?.n);
    const recent = await this.run(undefined, "SELECT `id`, `title`, `status`, `language_code`, `updated_at` FROM `knowledge_articles` WHERE `tenant_id` = ? AND `status` <> 'archived' ORDER BY `updated_at` DESC, `id` LIMIT 5", [tenant]);
    return { articles, documents, categories, recent };
  }

  // ---------- retrieval ----------

  /**
   * FULLTEXT is shared across tenants by MySQL design, so tenant_id is always a
   * top-level AND predicate. MATCH is also kept top-level so the index is used.
   * Visibility (published article / processed+published document) is enforced by
   * the joins, so draft and archived content can never be returned.
   */
  async searchChunks(p: RawSearchParams): Promise<Row[]> {
    const tenant = this.tenantBinary();
    const params: unknown[] = [p.match, tenant, p.match];
    let extra = '';
    if (p.language) { extra += ' AND c.`language_code` = ?'; params.push(p.language); }
    if (p.categoryId) { extra += ' AND cat.`id` = ?'; params.push(this.idBinary(p.categoryId, 'Category')); }
    params.push(p.limit);
    return this.run(
      undefined,
      `SELECT c.\`id\` AS chunk_id, c.\`article_id\`, c.\`document_id\`, c.\`content\`, c.\`language_code\`,
              MATCH(c.\`content\`) AGAINST (? IN NATURAL LANGUAGE MODE) AS score,
              a.\`title\` AS article_title, a.\`source_name\` AS article_source_name, a.\`source_url\` AS article_source_url,
              d.\`title\` AS document_title, d.\`source_name\` AS document_source_name, cat.\`name\` AS category_name
       FROM \`knowledge_chunks\` c
       LEFT JOIN \`knowledge_articles\` a ON a.\`id\` = c.\`article_id\` AND a.\`tenant_id\` = c.\`tenant_id\` AND a.\`status\` = 'published'
       LEFT JOIN \`knowledge_documents\` d ON d.\`id\` = c.\`document_id\` AND d.\`tenant_id\` = c.\`tenant_id\` AND d.\`status\` = 'processed' AND d.\`publication\` = 'published'
       LEFT JOIN \`knowledge_categories\` cat ON cat.\`tenant_id\` = c.\`tenant_id\` AND cat.\`id\` = COALESCE(a.\`category_id\`, d.\`category_id\`)
       WHERE c.\`tenant_id\` = ? AND MATCH(c.\`content\`) AGAINST (? IN NATURAL LANGUAGE MODE)
         AND (a.\`id\` IS NOT NULL OR d.\`id\` IS NOT NULL)${extra}
       ORDER BY score DESC, c.\`id\` LIMIT ?`,
      params,
    );
  }
}
