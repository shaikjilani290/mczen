import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6K durable audit events. Append-only by convention (the application only INSERTs and SELECTs).
 * `tenant_id` deliberately has no foreign key: audit rows must outlive tenant rows and platform events may
 * target a tenant. Metadata is sanitised by the application (field names and safe scalars only); the schema
 * has no column for secrets, tokens, ciphertext or audio.
 */
export class AuditEvents1740000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`audit_events\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`scope\` ENUM('tenant','platform') NOT NULL,
        \`tenant_id\` BINARY(16) NULL,
        \`actor_type\` ENUM('user','platform_admin','widget','system') NOT NULL,
        \`actor_id\` VARCHAR(64) NULL,
        \`action\` VARCHAR(80) NOT NULL,
        \`resource_type\` VARCHAR(40) NULL,
        \`resource_id\` VARCHAR(64) NULL,
        \`outcome\` ENUM('success','denied','failure') NOT NULL DEFAULT 'success',
        \`request_id\` VARCHAR(64) NULL,
        \`metadata\` JSON NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        KEY \`idx_audit_tenant_created\` (\`tenant_id\`, \`created_at\`),
        KEY \`idx_audit_tenant_action_created\` (\`tenant_id\`, \`action\`, \`created_at\`),
        KEY \`idx_audit_actor_created\` (\`actor_id\`, \`created_at\`),
        KEY \`idx_audit_resource\` (\`resource_type\`, \`resource_id\`),
        KEY \`idx_audit_scope_created\` (\`scope\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `audit_events`');
  }
}
