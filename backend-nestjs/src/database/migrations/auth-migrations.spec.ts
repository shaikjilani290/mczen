import type { QueryRunner } from 'typeorm';
import { ALL_MIGRATIONS, AuthPendingTokens1740000000004, AuthSecurityState1740000000005 } from './index';

function runner() {
  const query = jest.fn().mockResolvedValue([]);
  return { query, value: { query } as unknown as QueryRunner };
}
describe('Additive Phase 6C migrations', () => {
  it('registers the two 6C refinements directly after the unchanged three-migration baseline', () => {
    const names = ALL_MIGRATIONS.map((migration) => migration.name);
    const first = names.indexOf(AuthPendingTokens1740000000004.name);
    expect(first).toBe(3);
    expect(names.slice(first, first + 2)).toEqual([AuthPendingTokens1740000000004.name, AuthSecurityState1740000000005.name]);
    expect(new Set(names).size).toBe(names.length);
  });
  it('registers the Phase 6D migration after the 6C refinements', () => {
    const names = ALL_MIGRATIONS.map((migration) => migration.name);
    expect(names).toContain('AssistantConfiguration1740000000006');
    expect(names.indexOf('AssistantConfiguration1740000000006')).toBeGreaterThan(names.indexOf(AuthSecurityState1740000000005.name));
  });
  it('stores only typed hashed pending credentials, with an expiry cleanup index', async () => {
    const fake = runner();
    await new AuthPendingTokens1740000000004().up(fake.value);
    const sql = fake.query.mock.calls.map(([s]) => String(s)).join('\n');
    expect(sql).toContain("ENUM('password_reset','email_verify','invite')");
    expect(sql).toContain('`token_hash` CHAR(64)');
    expect(sql).toContain('ix_auth_pending_tokens_expires');
    expect(sql).not.toMatch(/`(?:token|password|secret)`\s/);
    expect(sql).not.toContain('CREATE TABLE `users`');
  });
  it('backfills the session version before enforcing NOT NULL, preserving existing users', async () => {
    const fake = runner();
    await new AuthSecurityState1740000000005().up(fake.value);
    const queries = fake.query.mock.calls.map(([sql]) => String(sql));
    expect(queries[0]).toContain('login_failure_window_started_at');
    expect(queries[1]).toContain('INT UNSIGNED NULL');
    expect(queries[2]).toContain('s.`token_version` = u.`token_version`');
    expect(queries[3]).toContain('INT UNSIGNED NOT NULL DEFAULT 1');
    expect(queries.join('\n')).not.toContain('DROP TABLE');
  });
  it('has explicit scratch-DB rollback paths for both refinements', async () => {
    const fake = runner();
    await new AuthSecurityState1740000000005().down(fake.value);
    await new AuthPendingTokens1740000000004().down(fake.value);
    expect(fake.query.mock.calls.map(([sql]) => String(sql)).join('\n')).toContain('DROP COLUMN `token_version`');
    expect(fake.query.mock.calls.map(([sql]) => String(sql)).join('\n')).toContain('DROP TABLE IF EXISTS `auth_pending_tokens`');
  });
});
