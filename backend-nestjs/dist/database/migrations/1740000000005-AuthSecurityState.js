"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthSecurityState1740000000005 = void 0;
class AuthSecurityState1740000000005 {
    async up(runner) {
        await runner.query('ALTER TABLE `users` ADD COLUMN `login_failure_window_started_at` DATETIME(3) NULL');
        await runner.query('ALTER TABLE `user_sessions` ADD COLUMN `token_version` INT UNSIGNED NULL');
        await runner.query(`UPDATE \`user_sessions\` s JOIN \`users\` u ON u.\`id\` = s.\`user_id\`
      SET s.\`token_version\` = u.\`token_version\``);
        await runner.query('ALTER TABLE `user_sessions` MODIFY COLUMN `token_version` INT UNSIGNED NOT NULL DEFAULT 1');
    }
    async down(runner) {
        await runner.query('ALTER TABLE `user_sessions` DROP COLUMN `token_version`');
        await runner.query('ALTER TABLE `users` DROP COLUMN `login_failure_window_started_at`');
    }
}
exports.AuthSecurityState1740000000005 = AuthSecurityState1740000000005;
//# sourceMappingURL=1740000000005-AuthSecurityState.js.map