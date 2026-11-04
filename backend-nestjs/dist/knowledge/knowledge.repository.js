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
exports.KnowledgeRepository = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const uuid_1 = require("../common/ids/uuid");
const tenant_scoped_repository_1 = require("../common/tenant/tenant-scoped.repository");
const knowledge_dto_1 = require("./knowledge.dto");
const escapeLike = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
let KnowledgeRepository = class KnowledgeRepository extends tenant_scoped_repository_1.TenantScopedRepository {
    source;
    constructor(source) {
        super(undefined);
        this.source = source;
    }
    get database() {
        if (!this.source)
            throw new common_1.ServiceUnavailableException('Knowledge management is unavailable.');
        return this.source;
    }
    transaction(work) {
        return this.database.transaction(work);
    }
    tenantBinary() {
        return (0, uuid_1.uuidToBinary)(this.currentTenantId());
    }
    tenantIdString() {
        return this.currentTenantId();
    }
    run(manager, sql, params = []) {
        return (manager ?? this.database).query(sql, params);
    }
    idBinary(id, what) {
        if (!(0, uuid_1.isUuidv7)(id))
            throw new common_1.NotFoundException(`${what} not found.`);
        return (0, uuid_1.uuidToBinary)(id);
    }
    async ensureDefaultCategories() {
        const tenant = this.tenantBinary();
        const existing = await this.run(undefined, 'SELECT COUNT(*) AS n FROM `knowledge_categories` WHERE `tenant_id` = ?', [tenant]);
        if (Number(existing[0]?.n) > 0)
            return;
        for (const [index, category] of knowledge_dto_1.DEFAULT_CATEGORIES.entries()) {
            await this.run(undefined, 'INSERT IGNORE INTO `knowledge_categories` (`id`, `tenant_id`, `name`, `slug`, `is_system`, `sort_order`) VALUES (?, ?, ?, ?, 1, ?)', [(0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()), tenant, category.name, category.slug, index]);
        }
    }
    async listCategories() {
        const tenant = this.tenantBinary();
        return this.run(undefined, `SELECT c.*,
         (SELECT COUNT(*) FROM \`knowledge_articles\` a WHERE a.\`category_id\` = c.\`id\` AND a.\`tenant_id\` = c.\`tenant_id\` AND a.\`status\` <> 'archived') AS article_count,
         (SELECT COUNT(*) FROM \`knowledge_documents\` d WHERE d.\`category_id\` = c.\`id\` AND d.\`tenant_id\` = c.\`tenant_id\` AND d.\`status\` <> 'archived') AS document_count
       FROM \`knowledge_categories\` c WHERE c.\`tenant_id\` = ? ORDER BY c.\`sort_order\`, c.\`name\``, [tenant]);
    }
    async findCategory(id, manager) {
        const rows = await this.run(manager, 'SELECT * FROM `knowledge_categories` WHERE `id` = ? AND `tenant_id` = ?', [this.idBinary(id, 'Category'), this.tenantBinary()]);
        if (!rows[0])
            throw new common_1.NotFoundException('Category not found.');
        return rows[0];
    }
    async insertCategory(name, slug, description) {
        const id = (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)());
        const tenant = this.tenantBinary();
        const [{ next }] = (await this.run(undefined, 'SELECT COALESCE(MAX(`sort_order`), 0) + 1 AS next FROM `knowledge_categories` WHERE `tenant_id` = ?', [tenant]));
        try {
            await this.run(undefined, 'INSERT INTO `knowledge_categories` (`id`, `tenant_id`, `name`, `slug`, `description`, `is_system`, `sort_order`) VALUES (?, ?, ?, ?, ?, 0, ?)', [id, tenant, name, slug, description, Math.min(Number(next), 65000)]);
        }
        catch (error) {
            if (error.code === 'ER_DUP_ENTRY')
                throw new common_1.ConflictException('A category with this name already exists.');
            throw error;
        }
        return id;
    }
    async updateCategory(id, fields) {
        const sets = [];
        const params = [];
        if (fields.name !== undefined) {
            sets.push('`name` = ?', '`slug` = ?');
            params.push(fields.name, fields.slug);
        }
        if (fields.description !== undefined) {
            sets.push('`description` = ?');
            params.push(fields.description);
        }
        try {
            await this.run(undefined, `UPDATE \`knowledge_categories\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`tenant_id\` = ?`, [...params, this.idBinary(id, 'Category'), this.tenantBinary()]);
        }
        catch (error) {
            if (error.code === 'ER_DUP_ENTRY')
                throw new common_1.ConflictException('A category with this name already exists.');
            throw error;
        }
    }
    async categoryUsage(id) {
        const binary = this.idBinary(id, 'Category');
        const tenant = this.tenantBinary();
        const rows = await this.run(undefined, 'SELECT (SELECT COUNT(*) FROM `knowledge_articles` WHERE `category_id` = ? AND `tenant_id` = ?) + (SELECT COUNT(*) FROM `knowledge_documents` WHERE `category_id` = ? AND `tenant_id` = ?) AS n', [binary, tenant, binary, tenant]);
        return Number(rows[0]?.n);
    }
    async deleteCategory(id) {
        await this.run(undefined, 'DELETE FROM `knowledge_categories` WHERE `id` = ? AND `tenant_id` = ? AND `is_system` = 0', [this.idBinary(id, 'Category'), this.tenantBinary()]);
    }
    async insertArticle(manager, a) {
        await this.run(manager, `INSERT INTO \`knowledge_articles\` (\`id\`, \`tenant_id\`, \`category_id\`, \`title\`, \`summary\`, \`content\`, \`language_code\`, \`status\`, \`source_name\`, \`source_url\`, \`reference_note\`, \`created_by\`, \`updated_by\`, \`published_at\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${a.status === 'published' ? 'CURRENT_TIMESTAMP(3)' : 'NULL'})`, [a.id, this.tenantBinary(), a.categoryId, a.title, a.summary, a.content, a.language, a.status, a.sourceName, a.sourceUrl, a.referenceNote, a.userId, a.userId]);
    }
    async updateArticle(manager, id, fields, publishing) {
        const columns = { categoryId: 'category_id', title: 'title', summary: 'summary', content: 'content', language: 'language_code', status: 'status', sourceName: 'source_name', sourceUrl: 'source_url', referenceNote: 'reference_note', updatedBy: 'updated_by' };
        const sets = [];
        const params = [];
        for (const [key, value] of Object.entries(fields)) {
            const column = columns[key];
            if (!column)
                continue;
            sets.push(`\`${column}\` = ?`);
            params.push(value);
        }
        if (publishing)
            sets.push('`published_at` = COALESCE(`published_at`, CURRENT_TIMESTAMP(3))');
        if (sets.length === 0)
            return;
        await this.run(manager, `UPDATE \`knowledge_articles\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`tenant_id\` = ?`, [...params, id, this.tenantBinary()]);
    }
    async findArticle(id, manager, lock = false) {
        const rows = await this.run(manager, `SELECT a.*, c.\`name\` AS category_name FROM \`knowledge_articles\` a JOIN \`knowledge_categories\` c ON c.\`id\` = a.\`category_id\` AND c.\`tenant_id\` = a.\`tenant_id\`
       WHERE a.\`id\` = ? AND a.\`tenant_id\` = ?${lock ? ' FOR UPDATE' : ''}`, [this.idBinary(id, 'Article'), this.tenantBinary()]);
        if (!rows[0])
            throw new common_1.NotFoundException('Article not found.');
        return rows[0];
    }
    async listArticles(q) {
        const where = ['a.`tenant_id` = ?'];
        const params = [this.tenantBinary()];
        if (q.status) {
            where.push('a.`status` = ?');
            params.push(q.status);
        }
        else
            where.push("a.`status` <> 'archived'");
        if (q.categoryId) {
            where.push('a.`category_id` = ?');
            params.push(this.idBinary(q.categoryId, 'Category'));
        }
        if (q.language) {
            where.push('a.`language_code` = ?');
            params.push(q.language);
        }
        if (q.tag) {
            where.push('EXISTS (SELECT 1 FROM `knowledge_article_tags` t WHERE t.`article_id` = a.`id` AND t.`tenant_id` = a.`tenant_id` AND t.`tag` = ?)');
            params.push(q.tag);
        }
        if (q.q) {
            where.push('(a.`title` LIKE ? OR a.`summary` LIKE ?)');
            params.push(`%${escapeLike(q.q)}%`, `%${escapeLike(q.q)}%`);
        }
        const clause = where.join(' AND ');
        const total = Number((await this.run(undefined, `SELECT COUNT(*) AS n FROM \`knowledge_articles\` a WHERE ${clause}`, params))[0]?.n);
        const rows = await this.run(undefined, `SELECT a.\`id\`, a.\`title\`, a.\`summary\`, a.\`language_code\`, a.\`status\`, a.\`category_id\`, a.\`created_by\`, a.\`updated_by\`, a.\`created_at\`, a.\`updated_at\`, a.\`published_at\`, c.\`name\` AS category_name
       FROM \`knowledge_articles\` a JOIN \`knowledge_categories\` c ON c.\`id\` = a.\`category_id\` AND c.\`tenant_id\` = a.\`tenant_id\`
       WHERE ${clause} ORDER BY a.\`updated_at\` DESC, a.\`id\` LIMIT ? OFFSET ?`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
        return { rows, total };
    }
    async tagsFor(articleIds) {
        if (articleIds.length === 0)
            return [];
        return this.run(undefined, `SELECT \`article_id\`, \`tag\` FROM \`knowledge_article_tags\` WHERE \`tenant_id\` = ? AND \`article_id\` IN (${articleIds.map(() => '?').join(',')}) ORDER BY \`tag\``, [this.tenantBinary(), ...articleIds]);
    }
    async replaceTags(manager, articleId, tags) {
        const tenant = this.tenantBinary();
        await this.run(manager, 'DELETE FROM `knowledge_article_tags` WHERE `article_id` = ? AND `tenant_id` = ?', [articleId, tenant]);
        for (const tag of tags) {
            await this.run(manager, 'INSERT INTO `knowledge_article_tags` (`article_id`, `tenant_id`, `tag`) VALUES (?, ?, ?)', [articleId, tenant, tag]);
        }
    }
    async replaceChunks(manager, parent, chunks, language) {
        const tenant = this.tenantBinary();
        const column = parent.articleId ? 'article_id' : 'document_id';
        const parentId = (parent.articleId ?? parent.documentId);
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
    async setChunkLanguage(manager, parent, language) {
        const column = parent.articleId ? 'article_id' : 'document_id';
        await this.run(manager, `UPDATE \`knowledge_chunks\` SET \`language_code\` = ? WHERE \`${column}\` = ? AND \`tenant_id\` = ?`, [language, (parent.articleId ?? parent.documentId), this.tenantBinary()]);
    }
    async insertDocument(d) {
        await this.run(undefined, `INSERT INTO \`knowledge_documents\` (\`id\`, \`tenant_id\`, \`category_id\`, \`title\`, \`original_filename\`, \`file_type\`, \`byte_size\`, \`content_hash\`, \`storage_key\`, \`language_code\`, \`publication\`, \`source_name\`, \`created_by\`, \`updated_by\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [d.id, this.tenantBinary(), d.categoryId, d.title, d.filename, d.fileType, d.byteSize, d.hash, d.storageKey, d.language, d.publication, d.sourceName, d.userId, d.userId]);
    }
    async updateDocument(id, fields, rawSets = []) {
        const columns = { categoryId: 'category_id', title: 'title', language: 'language_code', publication: 'publication', sourceName: 'source_name', status: 'status', errorCode: 'error_code', chunkCount: 'chunk_count', charCount: 'char_count', updatedBy: 'updated_by', originalFilename: 'original_filename', fileType: 'file_type', byteSize: 'byte_size', contentHash: 'content_hash' };
        const sets = [...rawSets];
        const params = [];
        for (const [key, value] of Object.entries(fields)) {
            const column = columns[key];
            if (!column)
                continue;
            sets.push(`\`${column}\` = ?`);
            params.push(value);
        }
        if (sets.length === 0)
            return;
        await this.run(undefined, `UPDATE \`knowledge_documents\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`tenant_id\` = ?`, [...params, id, this.tenantBinary()]);
    }
    async findDocument(id) {
        const rows = await this.run(undefined, `SELECT d.*, c.\`name\` AS category_name FROM \`knowledge_documents\` d JOIN \`knowledge_categories\` c ON c.\`id\` = d.\`category_id\` AND c.\`tenant_id\` = d.\`tenant_id\`
       WHERE d.\`id\` = ? AND d.\`tenant_id\` = ?`, [this.idBinary(id, 'Document'), this.tenantBinary()]);
        if (!rows[0])
            throw new common_1.NotFoundException('Document not found.');
        return rows[0];
    }
    async listDocuments(q) {
        const where = ['d.`tenant_id` = ?'];
        const params = [this.tenantBinary()];
        if (q.status) {
            where.push('d.`status` = ?');
            params.push(q.status);
        }
        else
            where.push("d.`status` <> 'archived'");
        if (q.categoryId) {
            where.push('d.`category_id` = ?');
            params.push(this.idBinary(q.categoryId, 'Category'));
        }
        if (q.language) {
            where.push('d.`language_code` = ?');
            params.push(q.language);
        }
        if (q.q) {
            where.push('(d.`title` LIKE ? OR d.`original_filename` LIKE ?)');
            params.push(`%${escapeLike(q.q)}%`, `%${escapeLike(q.q)}%`);
        }
        const clause = where.join(' AND ');
        const total = Number((await this.run(undefined, `SELECT COUNT(*) AS n FROM \`knowledge_documents\` d WHERE ${clause}`, params))[0]?.n);
        const rows = await this.run(undefined, `SELECT d.*, c.\`name\` AS category_name FROM \`knowledge_documents\` d JOIN \`knowledge_categories\` c ON c.\`id\` = d.\`category_id\` AND c.\`tenant_id\` = d.\`tenant_id\`
       WHERE ${clause} ORDER BY d.\`updated_at\` DESC, d.\`id\` LIMIT ? OFFSET ?`, [...params, q.pageSize, (q.page - 1) * q.pageSize]);
        return { rows, total };
    }
    async dashboardCounts() {
        const tenant = this.tenantBinary();
        const articles = await this.run(undefined, 'SELECT `status`, `language_code`, COUNT(*) AS n FROM `knowledge_articles` WHERE `tenant_id` = ? GROUP BY `status`, `language_code`', [tenant]);
        const documents = await this.run(undefined, 'SELECT `status`, COUNT(*) AS n FROM `knowledge_documents` WHERE `tenant_id` = ? GROUP BY `status`', [tenant]);
        const categories = Number((await this.run(undefined, 'SELECT COUNT(*) AS n FROM `knowledge_categories` WHERE `tenant_id` = ?', [tenant]))[0]?.n);
        const recent = await this.run(undefined, "SELECT `id`, `title`, `status`, `language_code`, `updated_at` FROM `knowledge_articles` WHERE `tenant_id` = ? AND `status` <> 'archived' ORDER BY `updated_at` DESC, `id` LIMIT 5", [tenant]);
        return { articles, documents, categories, recent };
    }
    async searchChunks(p) {
        const tenant = this.tenantBinary();
        const params = [p.match, tenant, p.match];
        let extra = '';
        if (p.language) {
            extra += ' AND c.`language_code` = ?';
            params.push(p.language);
        }
        if (p.categoryId) {
            extra += ' AND cat.`id` = ?';
            params.push(this.idBinary(p.categoryId, 'Category'));
        }
        params.push(p.limit);
        return this.run(undefined, `SELECT c.\`id\` AS chunk_id, c.\`article_id\`, c.\`document_id\`, c.\`content\`, c.\`language_code\`,
              MATCH(c.\`content\`) AGAINST (? IN NATURAL LANGUAGE MODE) AS score,
              a.\`title\` AS article_title, a.\`source_name\` AS article_source_name, a.\`source_url\` AS article_source_url,
              d.\`title\` AS document_title, d.\`source_name\` AS document_source_name, cat.\`name\` AS category_name
       FROM \`knowledge_chunks\` c
       LEFT JOIN \`knowledge_articles\` a ON a.\`id\` = c.\`article_id\` AND a.\`tenant_id\` = c.\`tenant_id\` AND a.\`status\` = 'published'
       LEFT JOIN \`knowledge_documents\` d ON d.\`id\` = c.\`document_id\` AND d.\`tenant_id\` = c.\`tenant_id\` AND d.\`status\` = 'processed' AND d.\`publication\` = 'published'
       LEFT JOIN \`knowledge_categories\` cat ON cat.\`tenant_id\` = c.\`tenant_id\` AND cat.\`id\` = COALESCE(a.\`category_id\`, d.\`category_id\`)
       WHERE c.\`tenant_id\` = ? AND MATCH(c.\`content\`) AGAINST (? IN NATURAL LANGUAGE MODE)
         AND (a.\`id\` IS NOT NULL OR d.\`id\` IS NOT NULL)${extra}
       ORDER BY score DESC, c.\`id\` LIMIT ?`, params);
    }
};
exports.KnowledgeRepository = KnowledgeRepository;
exports.KnowledgeRepository = KnowledgeRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], KnowledgeRepository);
//# sourceMappingURL=knowledge.repository.js.map