import { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase 6G conversation, transcript, and durable tool-audit persistence. */
export class ConversationPersistence1740000000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

    await queryRunner.query(`
      CREATE TABLE \`conversations\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`assistant_id\` BINARY(16) NOT NULL,
        \`user_id\` BINARY(16) NULL,
        \`channel\` ENUM('chat','voice','widget') NOT NULL DEFAULT 'chat',
        \`language_code\` CHAR(7) NULL,
        \`status\` ENUM('open','closed') NOT NULL DEFAULT 'open',
        \`title\` VARCHAR(150) NULL,
        \`metadata\` JSON NULL,
        \`message_count\` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        \`last_message_at\` DATETIME(3) NULL,
        \`retention_expires_at\` DATETIME(3) NULL,
        \`closed_at\` DATETIME(3) NULL,
        \`deleted_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_conversations_id_tenant\` (\`id\`,\`tenant_id\`),
        KEY \`ix_conversations_tenant_last_message\` (\`tenant_id\`,\`last_message_at\`),
        KEY \`ix_conversations_tenant_user\` (\`tenant_id\`,\`user_id\`),
        KEY \`ix_conversations_tenant_status\` (\`tenant_id\`,\`status\`),
        CONSTRAINT \`fk_conversations_assistant\` FOREIGN KEY (\`assistant_id\`,\`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`,\`tenant_id\`) ON DELETE RESTRICT,
        CONSTRAINT \`fk_conversations_tenants\` FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_conversations_users\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`conversation_messages\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`public_id\` BINARY(16) NOT NULL,
        \`conversation_id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`role\` ENUM('user','assistant','system') NOT NULL,
        \`content\` MEDIUMTEXT NOT NULL,
        \`status\` ENUM('complete','failed') NOT NULL DEFAULT 'complete',
        \`language_code\` CHAR(7) NULL,
        \`modality\` ENUM('text','voice') NOT NULL DEFAULT 'text',
        \`token_count\` INT UNSIGNED NULL,
        \`finish_reason\` VARCHAR(50) NULL,
        \`model\` VARCHAR(100) NULL,
        \`knowledge_sources_used\` JSON NULL,
        \`tool_calls_count\` TINYINT UNSIGNED NOT NULL DEFAULT 0,
        \`error_code\` VARCHAR(50) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_conversation_messages_public_id\` (\`public_id\`),
        UNIQUE KEY \`uk_conversation_messages_id_tenant\` (\`id\`,\`tenant_id\`),
        KEY \`ix_conversation_messages_conversation\` (\`conversation_id\`,\`id\`),
        KEY \`ix_conversation_messages_tenant_created\` (\`tenant_id\`,\`created_at\`),
        CONSTRAINT \`fk_conversation_messages_conversation\` FOREIGN KEY (\`conversation_id\`,\`tenant_id\`)
          REFERENCES \`conversations\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`message_tool_calls\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`message_id\` BIGINT UNSIGNED NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`tool_name\` VARCHAR(64) NOT NULL,
        \`round\` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        \`sequence_in_round\` TINYINT UNSIGNED NOT NULL DEFAULT 0,
        \`arguments\` JSON NOT NULL,
        \`result_summary\` JSON NULL,
        \`outcome\` ENUM('succeeded','rejected','failed','timed_out') NOT NULL,
        \`error_code\` VARCHAR(50) NULL,
        \`duration_ms\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`execution_log_id\` BIGINT UNSIGNED NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        KEY \`ix_message_tool_calls_message\` (\`message_id\`),
        KEY \`ix_message_tool_calls_name\` (\`tool_name\`),
        CONSTRAINT \`fk_message_tool_calls_message\` FOREIGN KEY (\`message_id\`,\`tenant_id\`)
          REFERENCES \`conversation_messages\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`conversation_feedback\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`message_id\` BIGINT UNSIGNED NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`rating\` ENUM('up','down') NOT NULL,
        \`comment\` VARCHAR(1000) NULL,
        \`created_by_user_id\` BINARY(16) NULL,
        \`created_by_anon_hash\` CHAR(64) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_conversation_feedback_user\` (\`message_id\`,\`created_by_user_id\`),
        UNIQUE KEY \`uk_conversation_feedback_anon\` (\`message_id\`,\`created_by_anon_hash\`),
        KEY \`ix_conversation_feedback_rating\` (\`rating\`,\`message_id\`),
        CONSTRAINT \`fk_conversation_feedback_message\` FOREIGN KEY (\`message_id\`,\`tenant_id\`)
          REFERENCES \`conversation_messages\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_conversation_feedback_users\` FOREIGN KEY (\`created_by_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      ALTER TABLE \`tool_execution_logs\`
        ADD COLUMN \`assistant_id\` BINARY(16) NULL AFTER \`tenant_id\`,
        ADD COLUMN \`arguments_summary\` JSON NULL AFTER \`arguments_size\`,
        ADD COLUMN \`result_summary\` JSON NULL AFTER \`arguments_summary\`,
        ADD KEY \`ix_tool_execution_logs_conversation\` (\`conversation_id\`,\`tenant_id\`)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`tool_execution_logs\`
        DROP INDEX \`ix_tool_execution_logs_conversation\`,
        DROP COLUMN \`result_summary\`,
        DROP COLUMN \`arguments_summary\`,
        DROP COLUMN \`assistant_id\`
    `);
    for (const table of [
      'conversation_feedback',
      'message_tool_calls',
      'conversation_messages',
      'conversations',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  }
}
