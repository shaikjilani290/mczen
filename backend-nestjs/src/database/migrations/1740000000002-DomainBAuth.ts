import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6B — Domain B: authentication and authorization tables
 * (Phase 6A §5, tables B1–B7, §12.4 step 2).
 *
 * - `users` is the GLOBAL identity root (not tenant-owned).
 * - `tenant_users` is the sole source of tenant authorization (§7.2).
 * - `roles`/`permissions` are platform-global catalogs (§5 B3/B4 decision).
 * - `user_sessions`/`refresh_tokens` are user-scoped; session revocation must
 *   remove token families unconditionally (cascade, §6.2).
 * - `tenant_api_keys.created_by` receives its FK now that `users` exists.
 */
export class DomainBAuth1740000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // B1. users — global human identity (login credential + PII).
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\` BINARY(16) NOT NULL,
        \`email\` VARCHAR(255) NOT NULL,
        \`email_verified_at\` DATETIME(3) NULL,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`status\` ENUM('active','disabled','erased') NOT NULL DEFAULT 'active',
        \`token_version\` INT UNSIGNED NOT NULL DEFAULT 1,
        \`failed_login_count\` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        \`locked_until\` DATETIME(3) NULL,
        \`last_login_at\` DATETIME(3) NULL,
        \`display_name\` VARCHAR(150) NULL,
        \`erased_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_users_email\` (\`email\`),
        KEY \`ix_users_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // B3. roles — GLOBAL catalog (is_platform=1 reserved for future staff roles).
    await queryRunner.query(`
      CREATE TABLE \`roles\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`key\` VARCHAR(50) NOT NULL,
        \`name\` VARCHAR(100) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`is_system\` TINYINT(1) NOT NULL DEFAULT 1,
        \`is_platform\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_roles_key\` (\`key\`),
        KEY \`ix_roles_is_platform\` (\`is_platform\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // B4. permissions — GLOBAL catalog of `resource:action` strings
    //     (the format already used by ToolPermissionService in Phase 5).
    await queryRunner.query(`
      CREATE TABLE \`permissions\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`key\` VARCHAR(100) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`category\` VARCHAR(50) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_permissions_key\` (\`key\`),
        KEY \`ix_permissions_category\` (\`category\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // B5. role_permissions — roles grant permissions.
    await queryRunner.query(`
      CREATE TABLE \`role_permissions\` (
        \`role_id\` BIGINT UNSIGNED NOT NULL,
        \`permission_id\` BIGINT UNSIGNED NOT NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`role_id\`, \`permission_id\`),
        KEY \`ix_role_permissions_permission\` (\`permission_id\`),
        CONSTRAINT \`fk_role_permissions_roles\` FOREIGN KEY (\`role_id\`)
          REFERENCES \`roles\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_role_permissions_permissions\` FOREIGN KEY (\`permission_id\`)
          REFERENCES \`permissions\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // B2. tenant_users — the membership/authorization join.
    await queryRunner.query(`
      CREATE TABLE \`tenant_users\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`user_id\` BINARY(16) NOT NULL,
        \`role_id\` BIGINT UNSIGNED NOT NULL,
        \`status\` ENUM('invited','active','suspended','removed') NOT NULL DEFAULT 'invited',
        \`invited_by\` BINARY(16) NULL,
        \`invited_at\` DATETIME(3) NULL,
        \`joined_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tenant_users_tenant_user\` (\`tenant_id\`, \`user_id\`),
        KEY \`ix_tenant_users_user\` (\`user_id\`),
        KEY \`ix_tenant_users_role\` (\`role_id\`),
        CONSTRAINT \`fk_tenant_users_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_tenant_users_users\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_tenant_users_roles\` FOREIGN KEY (\`role_id\`)
          REFERENCES \`roles\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_tenant_users_invited_by\` FOREIGN KEY (\`invited_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // B6. user_sessions — one row per login; JWT `sid` source.
    await queryRunner.query(`
      CREATE TABLE \`user_sessions\` (
        \`id\` BINARY(16) NOT NULL,
        \`user_id\` BINARY(16) NOT NULL,
        \`active_tenant_id\` BINARY(16) NULL,
        \`expires_at\` DATETIME(3) NOT NULL,
        \`revoked_at\` DATETIME(3) NULL,
        \`revoked_reason\` VARCHAR(50) NULL,
        \`ip\` VARBINARY(16) NULL,
        \`user_agent\` VARCHAR(255) NULL,
        \`last_seen_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        KEY \`ix_user_sessions_user_revoked\` (\`user_id\`, \`revoked_at\`),
        KEY \`ix_user_sessions_expires\` (\`expires_at\`),
        KEY \`ix_user_sessions_active_tenant\` (\`active_tenant_id\`),
        CONSTRAINT \`fk_user_sessions_users\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_user_sessions_tenants\` FOREIGN KEY (\`active_tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // B7. refresh_tokens — opaque, hash-only, family-based rotation
    //     (§4.6/§8.4). Session revocation removes token families unconditionally.
    await queryRunner.query(`
      CREATE TABLE \`refresh_tokens\` (
        \`id\` BINARY(16) NOT NULL,
        \`user_id\` BINARY(16) NOT NULL,
        \`session_id\` BINARY(16) NOT NULL,
        \`token_hash\` CHAR(64) NOT NULL,
        \`family_id\` BINARY(16) NOT NULL,
        \`expires_at\` DATETIME(3) NOT NULL,
        \`used_at\` DATETIME(3) NULL,
        \`revoked_at\` DATETIME(3) NULL,
        \`replaced_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_refresh_tokens_hash\` (\`token_hash\`),
        KEY \`ix_refresh_tokens_family\` (\`family_id\`),
        KEY \`ix_refresh_tokens_session\` (\`session_id\`),
        CONSTRAINT \`fk_refresh_tokens_users\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_refresh_tokens_sessions\` FOREIGN KEY (\`session_id\`)
          REFERENCES \`user_sessions\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_refresh_tokens_replaced_by\` FOREIGN KEY (\`replaced_by\`)
          REFERENCES \`refresh_tokens\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Deferred FK from Domain A: tenant_api_keys.created_by → users.
    await queryRunner.query(`
      ALTER TABLE \`tenant_api_keys\`
        ADD CONSTRAINT \`fk_tenant_api_keys_users\` FOREIGN KEY (\`created_by\`)
        REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the cross-domain FK before Domain A reverts tenant_api_keys.
    await queryRunner.query(
      'ALTER TABLE `tenant_api_keys` DROP FOREIGN KEY `fk_tenant_api_keys_users`',
    );
    await queryRunner.query('DROP TABLE IF EXISTS `refresh_tokens`');
    await queryRunner.query('DROP TABLE IF EXISTS `user_sessions`');
    await queryRunner.query('DROP TABLE IF EXISTS `tenant_users`');
    await queryRunner.query('DROP TABLE IF EXISTS `role_permissions`');
    await queryRunner.query('DROP TABLE IF EXISTS `roles`');
    await queryRunner.query('DROP TABLE IF EXISTS `permissions`');
    await queryRunner.query('DROP TABLE IF EXISTS `users`');
  }
}
