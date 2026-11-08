"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteIntegrations1740000000013 = void 0;
class WebsiteIntegrations1740000000013 {
    async up(queryRunner) {
        const tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
        await queryRunner.query(`
      CREATE TABLE \`website_integrations\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`assistant_id\` BINARY(16) NOT NULL,
        \`name\` VARCHAR(120) NOT NULL,
        \`origin\` VARCHAR(253) NOT NULL,
        \`public_key\` VARCHAR(60) NOT NULL,
        \`ingestion_key_hash\` CHAR(64) NOT NULL,
        \`status\` ENUM('active','revoked') NOT NULL DEFAULT 'active',
        \`sync_status\` ENUM('idle','running','completed','failed') NOT NULL DEFAULT 'idle',
        \`sync_started_at\` DATETIME(3) NULL,
        \`sync_finished_at\` DATETIME(3) NULL,
        \`last_sync_at\` DATETIME(3) NULL,
        \`pages_discovered\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`products_imported\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`knowledge_indexed\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`sync_errors\` JSON NULL,
        \`created_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_website_integrations_id_tenant\` (\`id\`,\`tenant_id\`),
        UNIQUE KEY \`uk_website_integrations_tenant_origin\` (\`tenant_id\`,\`origin\`),
        UNIQUE KEY \`uk_website_integrations_public_key\` (\`public_key\`),
        UNIQUE KEY \`uk_website_integrations_ingestion_hash\` (\`ingestion_key_hash\`),
        KEY \`ix_website_integrations_tenant_status\` (\`tenant_id\`,\`status\`),
        KEY \`ix_website_integrations_assistant\` (\`assistant_id\`,\`tenant_id\`),
        CONSTRAINT \`fk_website_integrations_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_website_integrations_assistants\` FOREIGN KEY (\`assistant_id\`,\`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_website_integrations_users\` FOREIGN KEY (\`created_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);
        await queryRunner.query(`
      CREATE TABLE \`website_pages\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`integration_id\` BINARY(16) NOT NULL,
        \`article_id\` BINARY(16) NOT NULL,
        \`canonical_url\` VARCHAR(1000) NOT NULL,
        \`url_hash\` CHAR(64) NOT NULL,
        \`content_hash\` CHAR(64) NOT NULL,
        \`title\` VARCHAR(200) NOT NULL,
        \`meta_description\` VARCHAR(1000) NULL,
        \`headings\` JSON NOT NULL,
        \`links\` JSON NOT NULL,
        \`page_type\` VARCHAR(30) NOT NULL DEFAULT 'page',
        \`last_updated_at\` DATETIME(3) NULL,
        \`last_seen_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`status\` ENUM('active','inactive') NOT NULL DEFAULT 'active',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_website_pages_id_tenant\` (\`id\`,\`tenant_id\`),
        UNIQUE KEY \`uk_website_pages_integration_url\` (\`integration_id\`,\`tenant_id\`,\`url_hash\`),
        KEY \`ix_website_pages_tenant_status\` (\`tenant_id\`,\`status\`),
        KEY \`ix_website_pages_tenant_type\` (\`tenant_id\`,\`page_type\`,\`status\`),
        KEY \`ix_website_pages_article\` (\`article_id\`,\`tenant_id\`),
        CONSTRAINT \`fk_website_pages_integrations\` FOREIGN KEY (\`integration_id\`,\`tenant_id\`)
          REFERENCES \`website_integrations\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_website_pages_articles\` FOREIGN KEY (\`article_id\`,\`tenant_id\`)
          REFERENCES \`knowledge_articles\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE
      ) ${tail}
    `);
        await queryRunner.query(`
      CREATE TABLE \`website_products\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`integration_id\` BINARY(16) NOT NULL,
        \`external_product_id\` VARCHAR(200) NOT NULL,
        \`name\` VARCHAR(200) NOT NULL,
        \`description\` MEDIUMTEXT NULL,
        \`sku\` VARCHAR(100) NULL,
        \`brand\` VARCHAR(150) NULL,
        \`category\` VARCHAR(150) NULL,
        \`price\` DECIMAL(13,2) NULL,
        \`sale_price\` DECIMAL(13,2) NULL,
        \`currency\` CHAR(3) NULL,
        \`stock\` INT NULL,
        \`availability\` ENUM('in_stock','out_of_stock','preorder','discontinued','unknown') NOT NULL DEFAULT 'unknown',
        \`images\` JSON NOT NULL,
        \`product_url\` VARCHAR(1000) NOT NULL,
        \`attributes\` JSON NOT NULL,
        \`content_hash\` CHAR(64) NOT NULL,
        \`external_updated_at\` DATETIME(3) NULL,
        \`last_seen_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`status\` ENUM('active','inactive') NOT NULL DEFAULT 'active',
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_website_products_id_tenant\` (\`id\`,\`tenant_id\`),
        UNIQUE KEY \`uk_website_products_external\` (\`integration_id\`,\`tenant_id\`,\`external_product_id\`),
        KEY \`ix_website_products_tenant_status\` (\`tenant_id\`,\`status\`,\`category\`),
        KEY \`ix_website_products_sku\` (\`tenant_id\`,\`sku\`),
        FULLTEXT KEY \`ft_website_products_search\` (\`name\`,\`description\`,\`brand\`,\`category\`),
        CONSTRAINT \`fk_website_products_integrations\` FOREIGN KEY (\`integration_id\`,\`tenant_id\`)
          REFERENCES \`website_integrations\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE
      ) ${tail}
    `);
        await queryRunner.query(`
      CREATE TABLE \`website_page_views\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`integration_id\` BINARY(16) NOT NULL,
        \`visitor_id\` BINARY(16) NOT NULL,
        \`page_url\` VARCHAR(1000) NOT NULL,
        \`page_hash\` CHAR(64) NOT NULL,
        \`page_title\` VARCHAR(300) NULL,
        \`referrer_origin\` VARCHAR(253) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        KEY \`ix_website_page_views_integration_created\` (\`integration_id\`,\`tenant_id\`,\`created_at\`),
        KEY \`ix_website_page_views_dedupe\` (\`integration_id\`,\`visitor_id\`,\`page_hash\`,\`created_at\`),
        CONSTRAINT \`fk_website_page_views_integrations\` FOREIGN KEY (\`integration_id\`,\`tenant_id\`)
          REFERENCES \`website_integrations\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE
      ) ${tail}
    `);
    }
    async down(queryRunner) {
        for (const table of ['website_page_views', 'website_products', 'website_pages', 'website_integrations']) {
            await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
        }
    }
}
exports.WebsiteIntegrations1740000000013 = WebsiteIntegrations1740000000013;
//# sourceMappingURL=1740000000013-WebsiteIntegrations.js.map