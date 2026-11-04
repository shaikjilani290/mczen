"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeManagement1740000000007 = void 0;
class KnowledgeManagement1740000000007 {
    async up(queryRunner) {
        const tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
        await queryRunner.query(`
      CREATE TABLE \`knowledge_categories\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`name\` VARCHAR(100) NOT NULL,
        \`slug\` VARCHAR(100) NOT NULL,
        \`description\` VARCHAR(500) NULL,
        \`is_system\` TINYINT(1) NOT NULL DEFAULT 0,
        \`sort_order\` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_knowledge_categories_slug\` (\`tenant_id\`, \`slug\`),
        UNIQUE KEY \`uk_knowledge_categories_id_tenant\` (\`id\`, \`tenant_id\`),
        CONSTRAINT \`fk_knowledge_categories_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE
      ) ${tail}
    `);
        await queryRunner.query(`
      CREATE TABLE \`knowledge_articles\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`category_id\` BINARY(16) NOT NULL,
        \`title\` VARCHAR(200) NOT NULL,
        \`summary\` VARCHAR(1000) NULL,
        \`content\` MEDIUMTEXT NOT NULL,
        \`language_code\` CHAR(2) NOT NULL DEFAULT 'en',
        \`status\` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
        \`source_name\` VARCHAR(200) NULL,
        \`source_url\` VARCHAR(500) NULL,
        \`reference_note\` VARCHAR(500) NULL,
        \`created_by\` BINARY(16) NULL,
        \`updated_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`published_at\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_knowledge_articles_id_tenant\` (\`id\`, \`tenant_id\`),
        KEY \`ix_knowledge_articles_list\` (\`tenant_id\`, \`status\`, \`language_code\`, \`updated_at\`),
        KEY \`ix_knowledge_articles_category\` (\`tenant_id\`, \`category_id\`),
        CONSTRAINT \`fk_knowledge_articles_category\` FOREIGN KEY (\`category_id\`, \`tenant_id\`)
          REFERENCES \`knowledge_categories\` (\`id\`, \`tenant_id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_knowledge_articles_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_knowledge_articles_created_by\` FOREIGN KEY (\`created_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`fk_knowledge_articles_updated_by\` FOREIGN KEY (\`updated_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);
        await queryRunner.query(`
      CREATE TABLE \`knowledge_article_tags\` (
        \`article_id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`tag\` VARCHAR(50) NOT NULL,
        PRIMARY KEY (\`article_id\`, \`tag\`),
        KEY \`ix_knowledge_article_tags_tenant\` (\`tenant_id\`, \`tag\`),
        CONSTRAINT \`fk_knowledge_article_tags_articles\` FOREIGN KEY (\`article_id\`, \`tenant_id\`)
          REFERENCES \`knowledge_articles\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE
      ) ${tail}
    `);
        await queryRunner.query(`
      CREATE TABLE \`knowledge_documents\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`category_id\` BINARY(16) NOT NULL,
        \`title\` VARCHAR(200) NOT NULL,
        \`original_filename\` VARCHAR(255) NOT NULL,
        \`file_type\` ENUM('pdf','docx','txt') NOT NULL,
        \`byte_size\` INT UNSIGNED NOT NULL,
        \`content_hash\` CHAR(64) NOT NULL,
        \`storage_key\` VARCHAR(255) NOT NULL,
        \`language_code\` CHAR(2) NOT NULL DEFAULT 'en',
        \`status\` ENUM('pending','processing','processed','failed','archived') NOT NULL DEFAULT 'pending',
        \`publication\` ENUM('draft','published') NOT NULL DEFAULT 'draft',
        \`error_code\` VARCHAR(50) NULL,
        \`chunk_count\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`char_count\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`source_name\` VARCHAR(200) NULL,
        \`created_by\` BINARY(16) NULL,
        \`updated_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`processed_at\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_knowledge_documents_id_tenant\` (\`id\`, \`tenant_id\`),
        KEY \`ix_knowledge_documents_list\` (\`tenant_id\`, \`status\`, \`updated_at\`),
        KEY \`ix_knowledge_documents_hash\` (\`tenant_id\`, \`content_hash\`),
        KEY \`ix_knowledge_documents_category\` (\`tenant_id\`, \`category_id\`),
        CONSTRAINT \`fk_knowledge_documents_category\` FOREIGN KEY (\`category_id\`, \`tenant_id\`)
          REFERENCES \`knowledge_categories\` (\`id\`, \`tenant_id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_knowledge_documents_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_knowledge_documents_created_by\` FOREIGN KEY (\`created_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`fk_knowledge_documents_updated_by\` FOREIGN KEY (\`updated_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);
        await queryRunner.query(`
      CREATE TABLE \`knowledge_chunks\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`article_id\` BINARY(16) NULL,
        \`document_id\` BINARY(16) NULL,
        \`chunk_index\` INT UNSIGNED NOT NULL,
        \`content\` TEXT NOT NULL,
        \`language_code\` CHAR(2) NOT NULL,
        \`char_count\` SMALLINT UNSIGNED NOT NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_knowledge_chunks_article\` (\`article_id\`, \`chunk_index\`),
        UNIQUE KEY \`uk_knowledge_chunks_document\` (\`document_id\`, \`chunk_index\`),
        KEY \`ix_knowledge_chunks_tenant_article\` (\`tenant_id\`, \`article_id\`),
        KEY \`ix_knowledge_chunks_tenant_document\` (\`tenant_id\`, \`document_id\`),
        FULLTEXT KEY \`ft_knowledge_chunks_content\` (\`content\`) WITH PARSER ngram,
        CONSTRAINT \`fk_knowledge_chunks_articles\` FOREIGN KEY (\`article_id\`, \`tenant_id\`)
          REFERENCES \`knowledge_articles\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_knowledge_chunks_documents\` FOREIGN KEY (\`document_id\`, \`tenant_id\`)
          REFERENCES \`knowledge_documents\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE
      ) ${tail}
    `);
    }
    async down(queryRunner) {
        for (const table of [
            'knowledge_chunks',
            'knowledge_documents',
            'knowledge_article_tags',
            'knowledge_articles',
            'knowledge_categories',
        ]) {
            await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
        }
    }
}
exports.KnowledgeManagement1740000000007 = KnowledgeManagement1740000000007;
//# sourceMappingURL=1740000000007-KnowledgeManagement.js.map