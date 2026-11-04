import { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase 6F Domain E. Adds tool persistence without changing earlier migrations. */
export class ToolConfiguration1740000000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

    await queryRunner.query(`
      CREATE TABLE \`tools\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(64) NOT NULL,
        \`display_name\` VARCHAR(100) NOT NULL,
        \`description\` VARCHAR(500) NOT NULL,
        \`category\` VARCHAR(30) NOT NULL,
        \`input_schema\` JSON NOT NULL,
        \`handler_ref\` VARCHAR(120) NOT NULL,
        \`timeout_ms\` INT UNSIGNED NOT NULL DEFAULT 10000,
        \`requires_confirmation\` TINYINT(1) NOT NULL DEFAULT 0,
        \`requires_permission_set\` TINYINT(1) NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`is_system\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tools_name\` (\`name\`),
        KEY \`ix_tools_category\` (\`category\`),
        KEY \`ix_tools_active\` (\`is_active\`)
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`tenant_tools\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`tool_id\` BIGINT UNSIGNED NOT NULL,
        \`enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`extra_permissions\` JSON NULL,
        \`max_calls_per_conversation\` SMALLINT UNSIGNED NULL,
        \`updated_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tenant_tools_tenant_tool\` (\`tenant_id\`, \`tool_id\`),
        KEY \`ix_tenant_tools_tool\` (\`tool_id\`),
        CONSTRAINT \`fk_tenant_tools_tenants\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_tenant_tools_tools\` FOREIGN KEY (\`tool_id\`) REFERENCES \`tools\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_tenant_tools_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`assistant_tools\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`assistant_id\` BINARY(16) NOT NULL,
        \`tool_id\` BIGINT UNSIGNED NOT NULL,
        \`enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_assistant_tools_scope\` (\`tenant_id\`, \`assistant_id\`, \`tool_id\`),
        KEY \`ix_assistant_tools_tool\` (\`tool_id\`),
        CONSTRAINT \`fk_assistant_tools_assistant\` FOREIGN KEY (\`assistant_id\`, \`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_assistant_tools_tenants\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_assistant_tools_tools\` FOREIGN KEY (\`tool_id\`) REFERENCES \`tools\` (\`id\`) ON DELETE RESTRICT
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`tool_permissions\` (
        \`tool_id\` BIGINT UNSIGNED NOT NULL,
        \`permission_id\` BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (\`tool_id\`, \`permission_id\`),
        KEY \`ix_tool_permissions_permission\` (\`permission_id\`),
        CONSTRAINT \`fk_tool_permissions_tools\` FOREIGN KEY (\`tool_id\`) REFERENCES \`tools\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_tool_permissions_permissions\` FOREIGN KEY (\`permission_id\`) REFERENCES \`permissions\` (\`id\`) ON DELETE CASCADE
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`tool_configurations\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`tool_id\` BIGINT UNSIGNED NOT NULL,
        \`config\` JSON NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`updated_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tool_configurations_tenant_tool\` (\`tenant_id\`, \`tool_id\`),
        KEY \`ix_tool_configurations_tool\` (\`tool_id\`),
        CONSTRAINT \`fk_tool_configurations_tenants\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_tool_configurations_tools\` FOREIGN KEY (\`tool_id\`) REFERENCES \`tools\` (\`id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_tool_configurations_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`tool_secrets\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`key_label\` VARCHAR(100) NOT NULL,
        \`key_version\` INT UNSIGNED NOT NULL DEFAULT 1,
        \`ciphertext\` VARBINARY(1024) NOT NULL,
        \`iv\` VARBINARY(12) NOT NULL,
        \`auth_tag\` VARBINARY(16) NOT NULL,
        \`last_rotated_at\` DATETIME(3) NULL,
        \`last_used_at\` DATETIME(3) NULL,
        \`expires_at\` DATETIME(3) NULL,
        \`revoked_at\` DATETIME(3) NULL,
        \`created_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tool_secrets_tenant_label\` (\`tenant_id\`, \`key_label\`),
        KEY \`ix_tool_secrets_revoked\` (\`tenant_id\`, \`revoked_at\`),
        CONSTRAINT \`fk_tool_secrets_tenants\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_tool_secrets_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`tool_execution_logs\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`tool_name\` VARCHAR(64) NOT NULL,
        \`conversation_id\` BINARY(16) NULL,
        \`message_id\` BIGINT UNSIGNED NULL,
        \`user_type\` ENUM('chat','api_key','widget','system','admin') NOT NULL DEFAULT 'chat',
        \`user_id\` BINARY(16) NULL,
        \`request_id\` VARCHAR(64) NULL,
        \`model\` VARCHAR(100) NULL,
        \`arguments_digest\` CHAR(64) NOT NULL,
        \`arguments_size\` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        \`outcome\` ENUM('succeeded','rejected','failed','timed_out') NOT NULL,
        \`error_code\` VARCHAR(50) NULL,
        \`error_message\` VARCHAR(500) NULL,
        \`duration_ms\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`started_at\` DATETIME(3) NOT NULL,
        \`finished_at\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`),
        KEY \`ix_tool_execution_logs_tenant_started\` (\`tenant_id\`, \`started_at\`),
        KEY \`ix_tool_execution_logs_tool_started\` (\`tool_name\`, \`started_at\`),
        KEY \`ix_tool_execution_logs_outcome_started\` (\`outcome\`, \`started_at\`),
        CONSTRAINT \`fk_tool_execution_logs_tenants\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_tool_execution_logs_users\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'tool_execution_logs',
      'tool_secrets',
      'tool_configurations',
      'tool_permissions',
      'assistant_tools',
      'tenant_tools',
      'tools',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  }
}
