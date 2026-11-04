"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthPendingTokens1740000000004 = void 0;
class AuthPendingTokens1740000000004 {
    async up(queryRunner) {
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
    async down(queryRunner) {
        await queryRunner.query('DROP TABLE IF EXISTS `auth_pending_tokens`');
    }
}
exports.AuthPendingTokens1740000000004 = AuthPendingTokens1740000000004;
//# sourceMappingURL=1740000000004-AuthPendingTokens.js.map