import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AssistantRepository } from './assistant.repository';
import { AssistantsService } from './assistants.service';
import { parseCreateAssistant, parseInstructions, parseSecretInput, parseSecretKind, parseUpdateAssistant } from './assistants.dto';
import { SecretCipher } from './secret-cipher.service';
import { AssistantConfiguration1740000000006 } from '../database/migrations/1740000000006-AssistantConfiguration';
import { ALL_MIGRATIONS } from '../database/migrations';
import { tenantContextStore, TenantContextMissingError } from '../common/tenant/tenant-context.store';
import { newUuidv7, uuidToBinary } from '../common/ids/uuid';

const KEY = 'a'.repeat(64);
const tenantA = newUuidv7();
const tenantB = newUuidv7();
const ctx = (tenantId: string) => ({ tenantId, actorType: 'user' as const, userId: newUuidv7(), permissions: ['assistants:read', 'assistants:write'] });

describe('assistant DTO validation', () => {
  it('rejects tenant ids and unknown keys anywhere in the payload', () => {
    expect(() => parseCreateAssistant({ name: 'x', tenantId: tenantB })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ tenantId: tenantB, profile: { name: 'x' } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ profile: { tenant_id: tenantB } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({})).toThrow(BadRequestException);
  });

  it('validates languages, providers, voice ranges, colours and URLs', () => {
    expect(parseUpdateAssistant({ language: { mode: 'manual', defaultLanguage: 'te', enabled: ['en', 'te'] } }).language?.enabled).toEqual(['en', 'te']);
    expect(() => parseUpdateAssistant({ language: { enabled: ['fr'] } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ language: { enabled: ['en', 'en'] } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ language: { enabled: ['en'], defaultLanguage: 'hi' } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ voice: { ttsProvider: 'evil' } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ voice: { speechRate: 5 } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ voice: { voiceId: 'a;drop' } })).toThrow(BadRequestException);
    expect(parseUpdateAssistant({ voice: { voiceGender: 'female', voiceId: 'hi_IN-pratham-medium', sttProvider: 'faster-whisper' } }).voice?.voiceId).toBe('hi_IN-pratham-medium');
    expect(() => parseUpdateAssistant({ branding: { primaryColor: 'red' } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ branding: { logoUrl: 'javascript:alert(1)' } })).toThrow(BadRequestException);
    expect(() => parseUpdateAssistant({ branding: { logoUrl: 'http://x.test/a.png' } })).toThrow(BadRequestException);
    expect(parseUpdateAssistant({ branding: { primaryColor: '#12abEF', logoUrl: 'https://x.test/a.png' } }).branding?.primaryColor).toBe('#12abEF');
  });

  it('bounds instructions and secrets without echoing input', () => {
    expect(() => parseInstructions({ systemPrompt: 'x'.repeat(16001) })).toThrow(BadRequestException);
    expect(parseInstructions({ systemPrompt: ' hi ' }).systemPrompt).toBe('hi');
    expect(() => parseSecretKind('admin')).toThrow(BadRequestException);
    expect(() => parseSecretInput({ apiKey: 'short' })).toThrow(BadRequestException);
    expect(() => parseSecretInput({ apiKey: 'long-enough-key', extra: 1 })).toThrow(BadRequestException);
    try { parseSecretInput({ apiKey: 'abc' }); } catch (e) { expect(JSON.stringify((e as BadRequestException).getResponse())).not.toContain('abc'); }
  });
});

describe('SecretCipher', () => {
  const original = process.env.SECRET_MASTER_KEY;
  afterEach(() => { if (original === undefined) delete process.env.SECRET_MASTER_KEY; else process.env.SECRET_MASTER_KEY = original; });

  it('round-trips, never stores plaintext, and binds to AAD', () => {
    process.env.SECRET_MASTER_KEY = KEY;
    const cipher = new SecretCipher();
    const sealed = cipher.encrypt('sk-live-123456', 't:a:tts');
    expect(sealed).not.toContain('sk-live-123456');
    expect(cipher.decrypt(sealed, 't:a:tts')).toBe('sk-live-123456');
    expect(() => cipher.decrypt(sealed, 'other:a:tts')).toThrow();
  });

  it('fails closed without a valid master key', () => {
    delete process.env.SECRET_MASTER_KEY;
    expect(() => new SecretCipher().encrypt('abcdefgh', 'x')).toThrow(ServiceUnavailableException);
    process.env.SECRET_MASTER_KEY = 'too-short';
    expect(() => new SecretCipher().encrypt('abcdefgh', 'x')).toThrow(ServiceUnavailableException);
  });

  it('is unaffected by SECRET_MASTER_KEY_VERSION (envelope is self-versioned)', () => {
    const previousVersion = process.env.SECRET_MASTER_KEY_VERSION;
    try {
      process.env.SECRET_MASTER_KEY = KEY;
      const cipher = new SecretCipher();
      const sealed = cipher.encrypt('sk-live-123456', 't:a:tts');
      expect(sealed.startsWith('v1:')).toBe(true);
      process.env.SECRET_MASTER_KEY_VERSION = '9';
      expect(cipher.decrypt(sealed, 't:a:tts')).toBe('sk-live-123456');
      delete process.env.SECRET_MASTER_KEY_VERSION;
      expect(cipher.decrypt(sealed, 't:a:tts')).toBe('sk-live-123456');
    } finally {
      if (previousVersion === undefined) delete process.env.SECRET_MASTER_KEY_VERSION;
      else process.env.SECRET_MASTER_KEY_VERSION = previousVersion;
    }
  });
});

describe('AssistantRepository tenant scoping', () => {
  const query = jest.fn();
  const repo = new AssistantRepository({ query } as never);
  beforeEach(() => query.mockReset().mockResolvedValue([]));

  it('fails closed without a tenant context', async () => {
    await expect(repo.list()).rejects.toThrow(TenantContextMissingError);
  });

  it('binds every query to the verified context tenant', async () => {
    await tenantContextStore.run(ctx(tenantA), () => repo.list());
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('`tenant_id` = ?');
    expect(params[0].equals(uuidToBinary(tenantA))).toBe(true);
  });

  it('treats malformed ids and other tenants\' ids as not found', async () => {
    await expect(tenantContextStore.run(ctx(tenantA), () => repo.find('not-a-uuid'))).rejects.toThrow(NotFoundException);
    await expect(tenantContextStore.run(ctx(tenantA), () => repo.find(newUuidv7()))).rejects.toThrow(NotFoundException);
    const [, params] = query.mock.calls[0];
    expect(params[1].equals(uuidToBinary(tenantA))).toBe(true);
  });
});

describe('AssistantsService secret redaction', () => {
  it('returns only configured flags, never ciphertext or keys', async () => {
    const id = newUuidv7();
    const repo = {
      toId: () => id,
      find: async () => ({ id: Buffer.alloc(16), is_default: 1, config_version: 3, name: 'Bot', status: 'active', language_mode: 'auto', response_style: 'balanced', show_sources: 0 }),
      voice: async () => ({ speech_enabled: 1, auto_speak: 1, stt_provider: 'browser', tts_provider: 'elevenlabs', voice_gender: 'female', voice_id: 'v1', speech_rate: '1.00', speech_pitch: '1.00' }),
      languages: async () => [{ language_code: 'en', is_enabled: 1, is_default: 1 }, { language_code: 'te', is_enabled: 1, is_default: 0 }],
      activeInstructions: async () => ({ version: 2, system_prompt: 'p', guardrail_notes: null }),
      configuredSecrets: async () => ['tts'],
    } as unknown as AssistantRepository;
    const config = await new AssistantsService(repo, new SecretCipher()).get(id);
    expect(config.secrets).toEqual({ stt: { configured: false }, tts: { configured: true } });
    expect(config.language.enabled).toEqual(['en', 'te']);
    expect(JSON.stringify(config)).not.toMatch(/cipher|apiKey|secret_|v1:/i);
  });
});

describe('AssistantConfiguration migration', () => {
  it('is registered after the 6B/6C migrations and does not alter earlier ones', () => {
    const names = ALL_MIGRATIONS.map((m) => m.name);
    expect(ALL_MIGRATIONS).toContain(AssistantConfiguration1740000000006);
    expect(names.indexOf('AssistantConfiguration1740000000006')).toBeGreaterThan(names.indexOf('AuthSecurityState1740000000005'));
    expect(new Set(names).size).toBe(names.length);
  });

  it('creates tenant-composite FKs and drops in reverse dependency order', async () => {
    const statements: string[] = [];
    const runner = { query: async (sql: string) => { statements.push(sql); } } as never;
    const migration = new AssistantConfiguration1740000000006();
    await migration.up(runner);
    const ddl = statements.join('\n');
    expect(ddl).not.toMatch(/\bJSON\b/);
    for (const child of ['assistant_instructions', 'assistant_voice_settings', 'assistant_language_settings', 'assistant_provider_secrets', 'assistant_config_audit']) {
      expect(ddl).toMatch(new RegExp(`CREATE TABLE \`${child}\`[\\s\\S]*?FOREIGN KEY \\(\`assistant_id\`, \`tenant_id\`\\)\\s+REFERENCES \`assistants\` \\(\`id\`, \`tenant_id\`\\)`));
    }
    statements.length = 0;
    await migration.down(runner);
    const dropped = statements.map((s) => /`(\w+)`/.exec(s)?.[1]);
    expect(dropped[dropped.length - 1]).toBe('assistants');
    expect(dropped).toHaveLength(6);
  });
});
