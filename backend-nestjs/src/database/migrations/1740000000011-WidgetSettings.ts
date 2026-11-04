import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6J embeddable widget: one settings row per tenant. The public key only
 * identifies the tenant; it never carries permissions. Origins are an exact
 * allowlist validated server-side on every public widget request.
 */
export class WidgetSettings1740000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`widget_settings\` (
        \`tenant_id\` BINARY(16) NOT NULL,
        \`public_key\` VARCHAR(64) NOT NULL,
        \`enabled\` TINYINT(1) NOT NULL DEFAULT 0,
        \`assistant_id\` BINARY(16) NULL,
        \`name\` VARCHAR(100) NOT NULL,
        \`logo_url\` VARCHAR(500) NULL,
        \`primary_color\` CHAR(7) NOT NULL DEFAULT '#4f46e5',
        \`theme\` ENUM('light','dark','auto') NOT NULL DEFAULT 'auto',
        \`position\` ENUM('bottom-right','bottom-left') NOT NULL DEFAULT 'bottom-right',
        \`button_style\` ENUM('round','pill','square') NOT NULL DEFAULT 'round',
        \`welcome_message\` VARCHAR(300) NULL,
        \`initial_greeting\` VARCHAR(1000) NULL,
        \`allowed_origins\` JSON NOT NULL,
        \`key_rotated_at\` DATETIME(3) NULL,
        \`updated_by\` BINARY(16) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`tenant_id\`),
        UNIQUE KEY \`uk_widget_settings_public_key\` (\`public_key\`),
        CONSTRAINT \`fk_widget_settings_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_widget_settings_updated_by\` FOREIGN KEY (\`updated_by\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `widget_settings`');
  }
}
