import * as mysql from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MysqlConfig } from '../../src/database/mysql-config';
import { ALL_MIGRATIONS } from '../../src/database/migrations';
import { newUuidv7, uuidToBinary } from '../../src/common/ids/uuid';
import { tenantContextStore } from '../../src/common/tenant/tenant-context.store';
import { ToolConfigurationRepository } from '../../src/tools/tool-configuration.repository';
import { ToolSecretCipher } from '../../src/tools/tool-secret-cipher';
import { VoiceSessionRepository } from '../../src/voice/voice-session.repository';
import type { VoiceSession } from '../../src/voice/voice.types';

/**
 * Opt-in real-MySQL suite for tool secrets and voice-session metadata (Phase 6K-E).
 * Same identity gate as mysql-phase6k.spec.ts, plus: the DB account must NOT be root.
 *   RUN_DB_TESTS=1 DB_HOST DB_PORT DB_USERNAME DB_PASSWORD DB_DATABASE
 * Only a throwaway schema `mczen_6k_<ts>_<rand>` is created and dropped. Credentials and
 * secret values are never printed. The master key used here is random and test-local.
 */
const dbUsername = process.env.DB_USERNAME ?? process.env.DB_USER;
const dbDatabase = process.env.DB_DATABASE ?? process.env.DB_NAME;
const RUN =
  process.env.RUN_DB_TESTS === '1' &&
  typeof process.env.DB_HOST === 'string' &&
  typeof process.env.DB_PORT === 'string' &&
  typeof process.env.DB_PASSWORD === 'string' &&
  typeof dbUsername === 'string' &&
  typeof dbDatabase === 'string';
const describeDb = RUN ? describe : describe.skip;
jest.setTimeout(180_000);

const TOOL = 'it_tool_6k';
const LABEL = `${TOOL}:credential`;
const PLAINTEXT_1 = 'plaintext-credential-one-6k';
const PLAINTEXT_2 = 'plaintext-credential-two-6k';

describeDb('Phase 6K-E tool secrets and voice session metadata (real isolated MySQL 8.4)', () => {
  const database = `mczen_6k_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const previousKey = process.env.SECRET_MASTER_KEY;
  const previousVersion = process.env.SECRET_MASTER_KEY_VERSION;
  const masterKey = randomBytes(32).toString('hex');
  let admin: Connection;
  let source: DataSource;
  let created = false;
  let secrets: ToolConfigurationRepository;
  let voice: VoiceSessionRepository;

  const tenantA = newUuidv7();
  const tenantB = newUuidv7();
  const actor = newUuidv7();
  const assistantA = newUuidv7();
  const assistantB = newUuidv7();
  const conversationA = newUuidv7();

  const rows = async (sql: string, params: unknown[] = []) => (await source.query(sql, params)) as Array<Record<string, unknown>>;
  const asTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
    tenantContextStore.run({ tenantId, actorType: 'user', permissions: [] }, fn);
  const secretRow = async (tenantId: string) =>
    (await rows('SELECT * FROM `tool_secrets` WHERE `tenant_id`=? AND `key_label`=?', [uuidToBinary(tenantId), LABEL]))[0];

  beforeAll(async () => {
    const host = process.env.DB_HOST as string;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Refusing to run: DB_HOST must be loopback.');
    if (String(dbUsername).toLowerCase() === 'root') throw new Error('Refusing to run: use a dedicated test account, not root.');
    if (!/^(mczen_test|mczen_6k)|_test$/i.test(dbDatabase as string)) {
      throw new Error('Refusing to run: DB_DATABASE is not named like a dedicated test database.');
    }
    admin = await mysql.createConnection({ host, port: Number(process.env.DB_PORT), user: dbUsername, password: process.env.DB_PASSWORD });
    const [[identity]] = await admin.query('SELECT VERSION() AS version, @@version_comment AS comment, @@port AS port') as unknown as [[Record<string, string | number>]];
    if (!/^8\.4\./.test(String(identity.version)) || /mariadb/i.test(`${identity.version} ${identity.comment}`)) {
      throw new Error('Refusing to run: server is not MySQL 8.4 (MariaDB/XAMPP and other versions are rejected).');
    }
    if (Number(identity.port) !== Number(process.env.DB_PORT)) throw new Error('Refusing to run: server port does not match DB_PORT.');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    created = true;
    source = new DataSource({
      ...MysqlConfig.fromEnv({ ...process.env, DB_DATABASE: database, DB_NAME: database }).toTypeormOptions(ALL_MIGRATIONS),
      entities: [], logging: false, migrationsTransactionMode: 'each', synchronize: false,
    });
    await source.initialize();
    await source.runMigrations();

    process.env.SECRET_MASTER_KEY = masterKey;
    process.env.SECRET_MASTER_KEY_VERSION = '1';
    secrets = new ToolConfigurationRepository(source, new ToolSecretCipher());
    voice = new VoiceSessionRepository(source);

    for (const [id, slug] of [[tenantA, 'a'], [tenantB, 'b']]) {
      await source.query('INSERT INTO `tenants` (`id`,`name`,`slug`) VALUES (?,?,?)', [uuidToBinary(id), `T ${slug}`, `sv-${slug}-${randomBytes(2).toString('hex')}`]);
    }
    await source.query('INSERT INTO `users` (`id`,`email`,`password_hash`) VALUES (?,?,?)', [uuidToBinary(actor), `actor-${randomBytes(3).toString('hex')}@example.test`, 'x'.repeat(60)]);
    await source.query('INSERT INTO `assistants` (`id`,`tenant_id`,`name`) VALUES (?,?,?)', [uuidToBinary(assistantA), uuidToBinary(tenantA), 'Assistant A']);
    await source.query('INSERT INTO `assistants` (`id`,`tenant_id`,`name`) VALUES (?,?,?)', [uuidToBinary(assistantB), uuidToBinary(tenantB), 'Assistant B']);
    await source.query('INSERT INTO `conversations` (`id`,`tenant_id`,`assistant_id`,`channel`) VALUES (?,?,?,\'voice\')', [uuidToBinary(conversationA), uuidToBinary(tenantA), uuidToBinary(assistantA)]);
    await source.query(
      'INSERT INTO `tools` (`name`,`display_name`,`description`,`category`,`input_schema`,`handler_ref`) VALUES (?,?,?,?,JSON_OBJECT(),?)',
      [TOOL, 'Integration tool', 'Integration test tool', 'test', 'it.handler'],
    );
  });

  afterAll(async () => {
    if (previousKey === undefined) delete process.env.SECRET_MASTER_KEY; else process.env.SECRET_MASTER_KEY = previousKey;
    if (previousVersion === undefined) delete process.env.SECRET_MASTER_KEY_VERSION; else process.env.SECRET_MASTER_KEY_VERSION = previousVersion;
    if (source?.isInitialized) await source.destroy();
    if (admin) {
      if (created && /^mczen_6k_[a-z0-9]+_[0-9a-f]{6}$/.test(database)) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });

  describe('tool secrets', () => {
    it('stores AES-256-GCM ciphertext and decrypts it for the owning tenant only', async () => {
      await asTenant(tenantA, () => secrets.setSecret(TOOL, actor, PLAINTEXT_1, null));
      const row = await secretRow(tenantA);
      expect(Number(row.key_version)).toBe(1);
      expect((row.iv as Buffer).length).toBe(12);
      expect((row.auth_tag as Buffer).length).toBe(16);
      const stored = Buffer.concat([row.ciphertext as Buffer, row.iv as Buffer, row.auth_tag as Buffer]);
      expect(stored.includes(Buffer.from(PLAINTEXT_1))).toBe(false);

      expect(await asTenant(tenantA, () => secrets.executionSecrets(TOOL))).toEqual({ credential: PLAINTEXT_1 });
      expect((await secretRow(tenantA)).last_used_at).not.toBeNull();
    });

    it('never exposes plaintext or ciphertext through status and detail responses', async () => {
      const row = await secretRow(tenantA);
      const status = await asTenant(tenantA, () => secrets.secretStatus(TOOL));
      const detail = await asTenant(tenantA, () => secrets.detail(TOOL));
      expect(status.configured).toBe(true);
      const serialised = JSON.stringify({ status, detail });
      expect(serialised).not.toContain(PLAINTEXT_1);
      for (const needle of [(row.ciphertext as Buffer), (row.auth_tag as Buffer), (row.iv as Buffer)]) {
        expect(serialised).not.toContain(needle.toString('hex'));
        expect(serialised).not.toContain(needle.toString('base64'));
      }
      expect(Object.keys(detail)).not.toEqual(expect.arrayContaining(['ciphertext']));
    });

    it('isolates tenants: no secret for tenant B, and copied ciphertext cannot be decrypted there', async () => {
      expect(await asTenant(tenantB, () => secrets.executionSecrets(TOOL))).toEqual({});
      expect((await asTenant(tenantB, () => secrets.secretStatus(TOOL))).configured).toBe(false);

      await source.query(
        'INSERT INTO `tool_secrets` (`id`,`tenant_id`,`key_label`,`key_version`,`ciphertext`,`iv`,`auth_tag`) ' +
        'SELECT ?,?,`key_label`,`key_version`,`ciphertext`,`iv`,`auth_tag` FROM `tool_secrets` WHERE `tenant_id`=? AND `key_label`=?',
        [uuidToBinary(newUuidv7()), uuidToBinary(tenantB), uuidToBinary(tenantA), LABEL],
      );
      await expect(asTenant(tenantB, () => secrets.executionSecrets(TOOL))).rejects.toThrow(ServiceUnavailableException);
      await source.query('DELETE FROM `tool_secrets` WHERE `tenant_id`=?', [uuidToBinary(tenantB)]);
      expect(await asTenant(tenantA, () => secrets.executionSecrets(TOOL))).toEqual({ credential: PLAINTEXT_1 });
    });

    it('rejects a wrong master key and an invalid authentication tag', async () => {
      process.env.SECRET_MASTER_KEY = randomBytes(32).toString('hex');
      try {
        await expect(asTenant(tenantA, () => secrets.executionSecrets(TOOL))).rejects.toThrow(ServiceUnavailableException);
      } finally {
        process.env.SECRET_MASTER_KEY = masterKey;
      }

      const original = (await secretRow(tenantA)).auth_tag as Buffer;
      await source.query('UPDATE `tool_secrets` SET `auth_tag`=? WHERE `tenant_id`=? AND `key_label`=?', [Buffer.alloc(16), uuidToBinary(tenantA), LABEL]);
      try {
        await expect(asTenant(tenantA, () => secrets.executionSecrets(TOOL))).rejects.toThrow(ServiceUnavailableException);
      } finally {
        await source.query('UPDATE `tool_secrets` SET `auth_tag`=? WHERE `tenant_id`=? AND `key_label`=?', [original, uuidToBinary(tenantA), LABEL]);
      }
      expect(await asTenant(tenantA, () => secrets.executionSecrets(TOOL))).toEqual({ credential: PLAINTEXT_1 });
    });

    it('enforces key-version behaviour and keeps version-1 secrets readable by default', async () => {
      process.env.SECRET_MASTER_KEY_VERSION = '2';
      try {
        await expect(asTenant(tenantA, () => secrets.executionSecrets(TOOL))).rejects.toThrow(ServiceUnavailableException);
      } finally {
        process.env.SECRET_MASTER_KEY_VERSION = '1';
      }
      delete process.env.SECRET_MASTER_KEY_VERSION;
      try {
        expect(await asTenant(tenantA, () => secrets.executionSecrets(TOOL))).toEqual({ credential: PLAINTEXT_1 });
      } finally {
        process.env.SECRET_MASTER_KEY_VERSION = '1';
      }
    });

    it('updates in place, honours expiry, and revokes and re-enables without losing the row', async () => {
      await asTenant(tenantA, () => secrets.setSecret(TOOL, actor, PLAINTEXT_2, null));
      expect(await rows('SELECT 1 FROM `tool_secrets` WHERE `tenant_id`=? AND `key_label`=?', [uuidToBinary(tenantA), LABEL])).toHaveLength(1);
      expect(await asTenant(tenantA, () => secrets.executionSecrets(TOOL))).toEqual({ credential: PLAINTEXT_2 });

      await asTenant(tenantA, () => secrets.setSecret(TOOL, actor, PLAINTEXT_2, '2000-01-01 00:00:00.000'));
      expect(await asTenant(tenantA, () => secrets.executionSecrets(TOOL))).toEqual({});
      expect((await asTenant(tenantA, () => secrets.secretStatus(TOOL))).configured).toBe(false);

      await asTenant(tenantA, () => secrets.setSecret(TOOL, actor, PLAINTEXT_1, null));
      await asTenant(tenantA, () => secrets.revokeSecret(TOOL));
      expect(await asTenant(tenantA, () => secrets.executionSecrets(TOOL))).toEqual({});
      const revoked = await secretRow(tenantA);
      expect(revoked.revoked_at).not.toBeNull();
      expect((await asTenant(tenantA, () => secrets.secretStatus(TOOL))).configured).toBe(false);

      await asTenant(tenantA, () => secrets.setSecret(TOOL, actor, PLAINTEXT_2, null));
      expect((await secretRow(tenantA)).revoked_at).toBeNull();
      expect(await asTenant(tenantA, () => secrets.executionSecrets(TOOL))).toEqual({ credential: PLAINTEXT_2 });
    });

    it('deletes secrets with their tenant', async () => {
      const doomed = newUuidv7();
      await source.query('INSERT INTO `tenants` (`id`,`name`,`slug`) VALUES (?,?,?)', [uuidToBinary(doomed), 'Doomed', `sv-d-${randomBytes(2).toString('hex')}`]);
      await asTenant(doomed, () => secrets.setSecret(TOOL, actor, PLAINTEXT_1, null));
      expect(await rows('SELECT 1 FROM `tool_secrets` WHERE `tenant_id`=?', [uuidToBinary(doomed)])).toHaveLength(1);
      await source.query('DELETE FROM `tenants` WHERE `id`=?', [uuidToBinary(doomed)]);
      expect(await rows('SELECT 1 FROM `tool_secrets` WHERE `tenant_id`=?', [uuidToBinary(doomed)])).toHaveLength(0);
    });
  });

  describe('voice session metadata', () => {
    const settings = {
      sttEngineId: 'faster-whisper', ttsEngineId: 'piper', sttLanguageHint: 'en', ttsVoice: 'en_US-amy-medium',
      vadSensitivity: 0.5, endpointSilenceMs: 700, minSpeechMs: 200, silenceNudgeMs: 0, bargeInEnabled: true, speechRate: 1,
    };
    const makeSession = (tenantId: string, assistantId: string, options: { userId?: string; conversationId?: string } = {}) => ({
      id: newUuidv7(),
      startedAt: Date.now(),
      state: 'listening',
      audioBytes: 4096,
      turnsCompleted: 2,
      interrupts: 1,
      listenMs: 500,
      speakMs: 300,
      context: {
        agent: { tenantId, userId: options.userId },
        assistantId,
        conversationId: options.conversationId,
        language: 'en',
        settings,
      },
    }) as unknown as VoiceSession;
    const sessionRow = async (session: VoiceSession) =>
      (await rows('SELECT * FROM `voice_sessions` WHERE `id`=?', [uuidToBinary(session.id)]))[0];
    const events = async (session: VoiceSession) =>
      (await rows('SELECT `event` FROM `voice_session_events` WHERE `session_id`=? ORDER BY `id`', [uuidToBinary(session.id)])).map((r) => String(r.event));

    it('persists an anonymous widget voice session and reads it back', async () => {
      const session = makeSession(tenantA, assistantA);
      await voice.create(session, 'widget');
      const row = await sessionRow(session);
      expect(row.user_id).toBeNull();
      expect(row.conversation_id).toBeNull();
      expect(row.state).toBe('listening');
      expect(row.stt_engine).toBe('faster-whisper');
      expect(row.client_info).toBe('widget');
      expect(Object.keys(row.settings_snapshot as Record<string, unknown>).sort()).toEqual(Object.keys(settings).sort());
      expect(await events(session)).toEqual(['session_start']);
    });

    it('keeps reconnect metadata consistent: one session row, ordered events, one close', async () => {
      const session = makeSession(tenantA, assistantA, { userId: actor });
      await voice.create(session, 'dashboard');
      await voice.updateConversation(session, conversationA);
      (session as { state: string }).state = 'speaking';
      await voice.updateState(session);
      await voice.event(session, 'session_resume');
      const open = await sessionRow(session);
      expect(Buffer.from(open.conversation_id as Buffer).equals(uuidToBinary(conversationA))).toBe(true);
      expect(open.state).toBe('speaking');
      expect(await rows('SELECT 1 FROM `voice_sessions` WHERE `id`=?', [uuidToBinary(session.id)])).toHaveLength(1);

      await voice.close(session, 'client_closed', null);
      const closed = await sessionRow(session);
      expect(closed.state).toBe('closed');
      expect(closed.ended_at).not.toBeNull();
      expect(Number(closed.turn_count)).toBe(2);
      expect(Number(closed.interrupt_count)).toBe(1);
      expect(closed.close_reason).toBe('client_closed');

      // Ended sessions are immutable: later updates and a second close change nothing.
      (session as { state: string }).state = 'listening';
      await voice.updateState(session);
      await voice.updateConversation(session, conversationA);
      await voice.close(session, 'again', 'X');
      const after = await sessionRow(session);
      expect(after.state).toBe('closed');
      expect(Number(after.turn_count)).toBe(2);
      expect(after.close_reason).toBe('client_closed');
      expect(await events(session)).toEqual(['session_start', 'session_resume', 'session_close', 'session_close']);
    });

    it('isolates tenants and assistants through composite foreign keys', async () => {
      const session = makeSession(tenantA, assistantA);
      await voice.create(session, 'widget');

      const foreign = { ...session, context: { ...session.context, agent: { tenantId: tenantB } } } as unknown as VoiceSession;
      (foreign as { state: string }).state = 'error';
      await voice.updateState(foreign);
      expect((await sessionRow(session)).state).toBe('listening');
      await expect(voice.close(foreign, 'x', null)).rejects.toThrow(/foreign key/i);
      expect((await sessionRow(session)).ended_at).toBeNull();

      await expect(voice.create(makeSession(tenantB, assistantA), 'widget')).rejects.toThrow(/foreign key/i);
      await expect(voice.create(makeSession(tenantA, assistantB), 'widget')).rejects.toThrow(/foreign key/i);
      await expect(voice.create(makeSession(tenantB, assistantB, { conversationId: conversationA }), 'widget')).rejects.toThrow(/foreign key/i);
    });

    it('applies the designed deletion behaviour', async () => {
      // user deleted -> session kept, user_id cleared
      const owner = newUuidv7();
      await source.query('INSERT INTO `users` (`id`,`email`,`password_hash`) VALUES (?,?,?)', [uuidToBinary(owner), `owner-${randomBytes(3).toString('hex')}@example.test`, 'x'.repeat(60)]);
      const withUser = makeSession(tenantA, assistantA, { userId: owner });
      await voice.create(withUser, 'dashboard');
      await source.query('DELETE FROM `users` WHERE `id`=?', [uuidToBinary(owner)]);
      expect((await sessionRow(withUser)).user_id).toBeNull();

      // conversation deleted -> its voice sessions and their events are removed
      const convo = newUuidv7();
      await source.query('INSERT INTO `conversations` (`id`,`tenant_id`,`assistant_id`,`channel`) VALUES (?,?,?,\'voice\')', [uuidToBinary(convo), uuidToBinary(tenantA), uuidToBinary(assistantA)]);
      const linked = makeSession(tenantA, assistantA, { conversationId: convo });
      await voice.create(linked, 'widget');
      await source.query('DELETE FROM `conversations` WHERE `id`=?', [uuidToBinary(convo)]);
      expect(await sessionRow(linked)).toBeUndefined();
      expect(await events(linked)).toEqual([]);

      // assistant and tenant deleted -> sessions removed (tenant with no conversations)
      const solo = newUuidv7();
      const soloAssistant = newUuidv7();
      await source.query('INSERT INTO `tenants` (`id`,`name`,`slug`) VALUES (?,?,?)', [uuidToBinary(solo), 'Solo', `sv-s-${randomBytes(2).toString('hex')}`]);
      await source.query('INSERT INTO `assistants` (`id`,`tenant_id`,`name`) VALUES (?,?,?)', [uuidToBinary(soloAssistant), uuidToBinary(solo), 'Solo A']);
      const s1 = makeSession(solo, soloAssistant);
      await voice.create(s1, 'widget');
      await source.query('DELETE FROM `assistants` WHERE `id`=?', [uuidToBinary(soloAssistant)]);
      expect(await sessionRow(s1)).toBeUndefined();

      const soloAssistant2 = newUuidv7();
      await source.query('INSERT INTO `assistants` (`id`,`tenant_id`,`name`) VALUES (?,?,?)', [uuidToBinary(soloAssistant2), uuidToBinary(solo), 'Solo B']);
      const s2 = makeSession(solo, soloAssistant2);
      await voice.create(s2, 'widget');
      await source.query('DELETE FROM `tenants` WHERE `id`=?', [uuidToBinary(solo)]);
      expect(await sessionRow(s2)).toBeUndefined();
      expect(await events(s2)).toEqual([]);
    });

    it('sanitises event detail and rejects unknown event names', async () => {
      const session = makeSession(tenantA, assistantA);
      await voice.create(session, 'widget');
      await voice.event(session, 'session_error', 'bad detail; DROP TABLE x');
      const [stored] = await rows('SELECT `detail` FROM `voice_session_events` WHERE `session_id`=? AND `event`=\'session_error\'', [uuidToBinary(session.id)]);
      expect(String(stored.detail)).toBe('bad_detail__DROP_TABLE_x');
      await expect(voice.event(session, 'not_a_real_event')).rejects.toThrow();
    });
  });
});
