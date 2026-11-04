import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6C — pending single-use token storage (§8.5).
 *
 * The architecture defines "a small pending-token table (or reuse of an opaque
 * verification_tokens pattern — not durable JWTs)" for password-reset,
 * email-verification and register-time invite tokens. The concrete shape was
 * not specified in §5, so this table is the documented 6C realization of that
 * pattern:
 *
 * - single-use, hashed (SHA-256, CHAR(64)) — never store the presented token;
 * - typed (`password_reset` | `email_verify` | `invite`), each type carries its
 *   own mailbox-specific expiry written by the issuing flow (60 min reset,
 *   24 h verify/invite);
 * - `payload` JSON reserved for join metadata of `invite` tokens
 *   (`role_key`, `tenant_id`);
 * - expiry-based purge is a future retention job (§12.3 rule 3, 6G+);
 * - DDL auto-commits in MySQL — documented-safe expand pattern.
 */
export class AuthPendingTokens1740000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`auth_pending_tokens\` (
        \`id\` BINARY(16) NOT NULL,
        \`user_id\` BINARY(16) NULL,
        \`type\` ENUM('password_reset','email_verify','invite') NOT NULL,
        \`token_hash\` CHAR(64) NOT NULL,
        \`payload\` JSON NULL,
        \`expires_at\` DATETIME(3) NOT NULL,
        \`used_at\` DATETIME(3) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_auth_pending_tokens_hash\` (\`token_hash\`),
        KEY \`ix_auth_pending_tokens_user\` (\`user_id\`, \`type\`),
        KEY \`ix_auth_pending_tokens_expires\` (\`expires_at\`),
        CONSTRAINT \`fk_auth_pending_tokens_users\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `auth_pending_tokens`');
  }
}
