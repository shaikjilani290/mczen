import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6D — tenant assistant configuration (Phase 6A Domain C, R1.6).
 *
 * - assistants: profile, greeting/fallback, language mode, branding, preferences.
 * - assistant_instructions: versioned system prompt (history kept for audit).
 * - assistant_voice_settings: 1:1 voice + STT/TTS provider choice.
 * - assistant_language_settings: enabled languages (en/hi/te) and the default.
 * - assistant_provider_secrets: write-only AES-256-GCM ciphertext, never returned.
 * - assistant_config_audit: append-only change history (field names, no values).
 *
 * Children use the composite (assistant_id, tenant_id) FK convention so a row
 * can never point at another tenant's assistant. Expand-only; down() reverses
 * the dependency order. Migrations 1–5 are untouched.
 */
export class AssistantConfiguration1740000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

    await queryRunner.query(`
      CREATE TABLE \`assistants\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`name\` VARCHAR(100) NOT NULL,
        \`description\` VARCHAR(500) NULL,
        \`personality\` VARCHAR(1000) NULL,
        \`greeting_message\` VARCHAR(1000) NULL,
        \`fallback_message\` VARCHAR(1000) NULL,
        \`status\` ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
        \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
        \`language_mode\` ENUM('auto','manual') NOT NULL DEFAULT 'auto',
        \`branding_display_name\` VARCHAR(100) NULL,
        \`branding_primary_color\` CHAR(7) NULL,
        \`branding_logo_url\` VARCHAR(500) NULL,
        \`response_style\` ENUM('concise','balanced','detailed') NOT NULL DEFAULT 'balanced',
        \`show_sources\` TINYINT(1) NOT NULL DEFAULT 0,
        \`config_version\` INT UNSIGNED NOT NULL DEFAULT 1,
        \`created_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        \`deleted_at\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_assistants_tenant_name\` (\`tenant_id\`, \`name\`),
        UNIQUE KEY \`uk_assistants_id_tenant\` (\`id\`, \`tenant_id\`),
        KEY \`ix_assistants_tenant_status\` (\`tenant_id\`, \`status\`),
        CONSTRAINT \`fk_assistants_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_assistants_created_by\` FOREIGN KEY (\`created_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`assistant_instructions\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`assistant_id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`version\` INT UNSIGNED NOT NULL,
        \`system_prompt\` MEDIUMTEXT NOT NULL,
        \`guardrail_notes\` TEXT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_assistant_instructions_version\` (\`assistant_id\`, \`version\`),
        KEY \`ix_assistant_instructions_active\` (\`assistant_id\`, \`is_active\`),
        KEY \`ix_assistant_instructions_tenant\` (\`tenant_id\`),
        CONSTRAINT \`fk_assistant_instructions_assistants\` FOREIGN KEY (\`assistant_id\`, \`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_assistant_instructions_created_by\` FOREIGN KEY (\`created_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`assistant_voice_settings\` (
        \`assistant_id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`speech_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`auto_speak\` TINYINT(1) NOT NULL DEFAULT 1,
        \`stt_provider\` VARCHAR(50) NOT NULL DEFAULT 'browser',
        \`tts_provider\` VARCHAR(50) NOT NULL DEFAULT 'browser',
        \`voice_gender\` ENUM('female','male','neutral') NOT NULL DEFAULT 'neutral',
        \`voice_id\` VARCHAR(150) NULL,
        \`speech_rate\` DECIMAL(3,2) NOT NULL DEFAULT 1.00,
        \`speech_pitch\` DECIMAL(3,2) NOT NULL DEFAULT 1.00,
        \`updated_by\` BINARY(16) NULL,
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`assistant_id\`),
        KEY \`ix_assistant_voice_settings_tenant\` (\`tenant_id\`),
        CONSTRAINT \`fk_assistant_voice_settings_assistants\` FOREIGN KEY (\`assistant_id\`, \`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_assistant_voice_settings_updated_by\` FOREIGN KEY (\`updated_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`assistant_language_settings\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`assistant_id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`language_code\` CHAR(2) NOT NULL,
        \`is_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_assistant_language_settings\` (\`assistant_id\`, \`language_code\`),
        KEY \`ix_assistant_language_settings_tenant\` (\`tenant_id\`, \`is_enabled\`),
        CONSTRAINT \`fk_assistant_language_settings_assistants\` FOREIGN KEY (\`assistant_id\`, \`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`assistant_provider_secrets\` (
        \`assistant_id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`kind\` ENUM('stt','tts') NOT NULL,
        \`ciphertext\` VARCHAR(2048) NOT NULL,
        \`updated_by\` BINARY(16) NULL,
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`assistant_id\`, \`kind\`),
        KEY \`ix_assistant_provider_secrets_tenant\` (\`tenant_id\`),
        CONSTRAINT \`fk_assistant_provider_secrets_assistants\` FOREIGN KEY (\`assistant_id\`, \`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_assistant_provider_secrets_updated_by\` FOREIGN KEY (\`updated_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);

    await queryRunner.query(`
      CREATE TABLE \`assistant_config_audit\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`assistant_id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`actor_user_id\` BINARY(16) NULL,
        \`action\` ENUM('create','update','instructions','secret_set','secret_clear') NOT NULL,
        \`config_version\` INT UNSIGNED NOT NULL,
        \`changed_fields\` VARCHAR(1000) NOT NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        KEY \`ix_assistant_config_audit_assistant\` (\`assistant_id\`, \`id\`),
        KEY \`ix_assistant_config_audit_tenant\` (\`tenant_id\`, \`created_at\`),
        CONSTRAINT \`fk_assistant_config_audit_assistants\` FOREIGN KEY (\`assistant_id\`, \`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`, \`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_assistant_config_audit_actor\` FOREIGN KEY (\`actor_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ${tail}
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'assistant_config_audit',
      'assistant_provider_secrets',
      'assistant_language_settings',
      'assistant_voice_settings',
      'assistant_instructions',
      'assistants',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  }
}
