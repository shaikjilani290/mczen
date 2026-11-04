import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive 6C realization of §8.3's 15-minute failure window and §8.2's
 * token_version revocation. The accepted 6B migration files stay unchanged.
 * MySQL DDL auto-commits: run after backup/rehearsal, not at application boot.
 */
export class AuthSecurityState1740000000005 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE `users` ADD COLUMN `login_failure_window_started_at` DATETIME(3) NULL');
    await runner.query('ALTER TABLE `user_sessions` ADD COLUMN `token_version` INT UNSIGNED NULL');
    await runner.query(`UPDATE \`user_sessions\` s JOIN \`users\` u ON u.\`id\` = s.\`user_id\`
      SET s.\`token_version\` = u.\`token_version\``);
    await runner.query('ALTER TABLE `user_sessions` MODIFY COLUMN `token_version` INT UNSIGNED NOT NULL DEFAULT 1');
  }

  /** Rehearsal/scratch-DB rollback only; drops authentication state. */
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE `user_sessions` DROP COLUMN `token_version`');
    await runner.query('ALTER TABLE `users` DROP COLUMN `login_failure_window_started_at`');
  }
}
