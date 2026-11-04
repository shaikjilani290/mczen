import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6B — Domain A: tenant management (Phase 6A §5, tables A1–A4, §12.4 step 2).
 *
 * DDL notes:
 * - MySQL DDL statements auto-commit (no transactional DDL in MySQL 8), so this
 *   migration is executed statement-by-statement in strict order; the `down`
 *   path reverses the steps. This is the documented-safe "expand" pattern.
 * - Every table pins ENGINE=InnoDB and the database-wide charset/collation
 *   (utf8mb4 / utf8mb4_0900_ai_ci) so environment drift cannot change matching
 *   semantics (Phase 6A §4.2).
 * - `tenant_domains.is_live` implements the partial-uniqueness convention
 *   (Phase 6A §4.3): the generated column is 1 while the row is live, NULL once
 *   soft-deleted, so a soft-deleted row frees its (tenant_id, domain) value —
 *   NULL never collides in a unique index.
 */
export class DomainATenants1740000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A1. tenants — the root of all tenancy.
    await queryRunner.query(`
      CREATE TABLE \`tenants\` (
        \`id\` BINARY(16) NOT NULL,
        \`name\` VARCHAR(150) NOT NULL,
        \`slug\` VARCHAR(63) NOT NULL,
        \`status\` ENUM('active','suspended','closed') NOT NULL DEFAULT 'active',
        \`default_language_code\` CHAR(7) NULL,
        \`timezone\` VARCHAR(64) NOT NULL DEFAULT 'UTC',
        \`suspended_at\` DATETIME(3) NULL,
        \`suspended_reason\` VARCHAR(255) NULL,
        \`deleted_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tenants_slug\` (\`slug\`),
        KEY \`ix_tenants_status\` (\`status\`),
        KEY \`ix_tenants_created_at\` (\`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // A2. tenant_settings — 1:1 with tenants (shared PK).
    await queryRunner.query(`
      CREATE TABLE \`tenant_settings\` (
        \`tenant_id\` BINARY(16) NOT NULL,
        \`max_assistants\` SMALLINT UNSIGNED NOT NULL DEFAULT 3,
        \`max_users\` SMALLINT UNSIGNED NOT NULL DEFAULT 10,
        \`max_knowledge_documents\` INT UNSIGNED NOT NULL DEFAULT 200,
        \`data_retention_days\` SMALLINT UNSIGNED NOT NULL DEFAULT 365,
        \`feature_flags\` JSON NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`tenant_id\`),
        CONSTRAINT \`fk_tenant_settings_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // A3. tenant_domains — domains a tenant owns; verified origins live here later.
    await queryRunner.query(`
      CREATE TABLE \`tenant_domains\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`domain\` VARCHAR(253) NOT NULL,
        \`verification_token\` VARCHAR(64) NULL,
        \`verified_at\` DATETIME(3) NULL,
        \`is_primary\` TINYINT(1) NOT NULL DEFAULT 0,
        \`deleted_at\` DATETIME(3) NULL,
        \`is_live\` TINYINT(1) GENERATED ALWAYS AS (IF(\`deleted_at\` IS NULL, 1, NULL)) VIRTUAL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tenant_domains_tenant_domain_live\` (\`tenant_id\`, \`domain\`, \`is_live\`),
        KEY \`ix_tenant_domains_domain\` (\`domain\`),
        CONSTRAINT \`fk_tenant_domains_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // A4. tenant_api_keys — hash-only server-to-server credentials.
    //     `created_by` gets its FK in the Domain B migration (users must exist
    //     first — Phase 6A §5 A4 + §12.4 ordering).
    await queryRunner.query(`
      CREATE TABLE \`tenant_api_keys\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`name\` VARCHAR(100) NOT NULL,
        \`key_prefix\` VARCHAR(12) NOT NULL,
        \`key_hash\` CHAR(64) NOT NULL,
        \`scopes\` JSON NULL,
        \`created_by\` BINARY(16) NULL,
        \`last_used_at\` DATETIME(3) NULL,
        \`expires_at\` DATETIME(3) NULL,
        \`revoked_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tenant_api_keys_hash\` (\`key_hash\`),
        UNIQUE KEY \`uk_tenant_api_keys_prefix\` (\`key_prefix\`),
        KEY \`ix_tenant_api_keys_tenant_revoked\` (\`tenant_id\`, \`revoked_at\`),
        CONSTRAINT \`fk_tenant_api_keys_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order; tenant_api_keys has no outbound FK until B adds it.
    await queryRunner.query('DROP TABLE IF EXISTS `tenant_api_keys`');
    await queryRunner.query('DROP TABLE IF EXISTS `tenant_domains`');
    await queryRunner.query('DROP TABLE IF EXISTS `tenant_settings`');
    await queryRunner.query('DROP TABLE IF EXISTS `tenants`');
  }
}
