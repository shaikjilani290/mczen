import { assertProductionConfig, ProductionConfigError, validateProductionConfig } from './production-config';
import { ReadinessController } from '../health/readiness.controller';
import { MemorySharedState } from '../shared-state/memory-shared-state';

const SECRETS = {
  jwt: 'J'.repeat(48) + 'q9',
  master: 'a1'.repeat(32),
  widget: 'W'.repeat(40) + 'z7',
  dbPassword: 'mczen@3211',
  redis: 'rediss://:redis-pass-999@cache.internal:6380',
};

const valid = {
  NODE_ENV: 'production',
  JWT_SECRET: SECRETS.jwt,
  SECRET_MASTER_KEY: SECRETS.master,
  MCZEN_WIDGET_SESSION_SECRET: SECRETS.widget,
  DB_HOST: 'db.internal', DB_PORT: '3308', DB_USERNAME: 'mczen_app', DB_DATABASE: 'mczen_db', DB_PASSWORD: SECRETS.dbPassword,
  REDIS_URL: SECRETS.redis,
  MCZEN_CORS_ORIGINS: 'https://app.example.test',
};

describe('validateProductionConfig', () => {
  it('accepts a complete production environment and ignores non-production', () => {
    expect(validateProductionConfig(valid)).toEqual([]);
    expect(validateProductionConfig({ NODE_ENV: 'development' })).toEqual([]);
    expect(() => assertProductionConfig({})).not.toThrow();
  });

  it('accepts an explicit trusted proxy IP and rejects everything looser', () => {
    expect(validateProductionConfig({ ...valid, MCZEN_TRUST_PROXY: '127.0.0.1' })).toEqual([]);
    expect(validateProductionConfig({ ...valid, MCZEN_TRUST_PROXY: '::1,127.0.0.1' })).toEqual([]);
  });

  it('treats SECRET_MASTER_KEY_VERSION as optional but validates it when present', () => {
    expect(validateProductionConfig({ ...valid, SECRET_MASTER_KEY_VERSION: undefined })).toEqual([]);
    expect(validateProductionConfig({ ...valid, SECRET_MASTER_KEY_VERSION: '3' })).toEqual([]);
    for (const bad of ['', '0', '-1', '1.5', 'abc', ' 2', '1e2', '1234567890']) {
      const problems = validateProductionConfig({ ...valid, SECRET_MASTER_KEY_VERSION: bad });
      expect(problems.map((p) => p.variable)).toEqual(['SECRET_MASTER_KEY_VERSION']);
    }
  });

  it.each([
    ['MCZEN_TRUST_PROXY', { MCZEN_TRUST_PROXY: '127.0.0.1,' }],
    ['MCZEN_TRUST_PROXY', { MCZEN_TRUST_PROXY: ',127.0.0.1' }],
    ['MCZEN_TRUST_PROXY', { MCZEN_TRUST_PROXY: '127.0.0.1,,::1' }],
  ])('rejects malformed proxy list for %s: %j', (variable, override) => {
    expect(validateProductionConfig({ ...valid, ...override }).map((p) => p.variable)).toContain(variable);
  });

  it.each([
    ['JWT_SECRET', { JWT_SECRET: undefined }],
    ['JWT_SECRET', { JWT_SECRET: 'short' }],
    ['JWT_SECRET', { JWT_SECRET: 'change-me-change-me-change-me-change-me' }],
    ['SECRET_MASTER_KEY', { SECRET_MASTER_KEY: undefined }],
    ['SECRET_MASTER_KEY', { SECRET_MASTER_KEY: 'not-a-key' }],
    ['MCZEN_WIDGET_SESSION_SECRET', { MCZEN_WIDGET_SESSION_SECRET: undefined }],
    ['MCZEN_WIDGET_SESSION_SECRET', { MCZEN_WIDGET_SESSION_SECRET: 'tooshort' }],
    ['MCZEN_WIDGET_SESSION_SECRET', { MCZEN_WIDGET_SESSION_SECRET: SECRETS.jwt }],
    ['DB_HOST', { DB_HOST: undefined }],
    ['DB_PASSWORD', { DB_PASSWORD: '' }],
    ['SHARED_STATE_DRIVER/REDIS_URL', { REDIS_URL: undefined }],
    ['SHARED_STATE_DRIVER/REDIS_URL', { REDIS_URL: 'redis://cache.example.test:6379' }],
    ['MCZEN_CORS_ORIGINS', { MCZEN_CORS_ORIGINS: '' }],
    ['MCZEN_ALLOW_DEV_HEADER', { MCZEN_ALLOW_DEV_HEADER: '1' }],
    ['MCZEN_TRUST_PROXY', { MCZEN_TRUST_PROXY: 'true' }],
    ['MCZEN_TRUST_PROXY', { MCZEN_TRUST_PROXY: 'proxy.example.test' }],
  ])('reports %s for %j', (variable, override) => {
    const problems = validateProductionConfig({ ...valid, ...override });
    expect(problems.map((p) => p.variable)).toContain(variable);
  });

  it('does not silently fall back to process-local state without explicit acknowledgement', () => {
    const { REDIS_URL: _drop, ...rest } = valid;
    void _drop;
    expect(validateProductionConfig({ ...rest, SHARED_STATE_DRIVER: 'memory' }).map((p) => p.variable)).toContain('SHARED_STATE_DRIVER/REDIS_URL');
    expect(validateProductionConfig({ ...rest, SHARED_STATE_DRIVER: 'memory', MCZEN_ALLOW_PROCESS_LOCAL_STATE: 'true' })).toEqual([]);
  });

  it('never includes secret values in problems or the thrown error', () => {
    const bad = { ...valid, JWT_SECRET: 'short-secret-value', SECRET_MASTER_KEY: 'bad-master-value', MCZEN_WIDGET_SESSION_SECRET: 'bad-widget', REDIS_URL: 'redis://:leaky-pass@cache.example.test:6379' };
    let error: unknown;
    try { assertProductionConfig(bad); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ProductionConfigError);
    const text = JSON.stringify(validateProductionConfig(bad)) + String((error as Error).message);
    for (const secret of ['short-secret-value', 'bad-master-value', 'bad-widget', 'leaky-pass', SECRETS.dbPassword]) expect(text).not.toContain(secret);
  });
});

describe('ReadinessController', () => {
  function build(options: { db?: boolean; auditTable?: boolean; stateOk?: boolean } = {}) {
    const { db = true, auditTable = true, stateOk = true } = options;
    const source = {
      query: jest.fn(async (sql: string) => {
        if (!db) throw new Error('connect ECONNREFUSED 10.0.0.5 with password hunter2');
        if (sql.includes('audit_events') && !auditTable) throw new Error("Table 'x.audit_events' doesn't exist");
        return [{ 1: 1 }];
      }),
    };
    const store = new MemorySharedState();
    jest.spyOn(store, 'health').mockImplementation(async () => { if (!stateOk) throw new Error('redis://:pw@host down'); return { ok: true, driver: 'memory' }; });
    const response = { status: jest.fn(), setHeader: jest.fn() };
    const controller = new ReadinessController(source as never, store, { failureCount: 2 } as never);
    return { controller, response };
  }

  it('is ready (200) with every required dependency healthy, and sets no-store', async () => {
    const { controller, response } = build();
    const result = await controller.ready(response as never);
    expect(result).toMatchObject({ status: 'ready', checks: { database: 'ok', auditSchema: 'ok', sharedState: 'ok' }, auditWriteFailures: 2 });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it.each([[{ db: false }], [{ auditTable: false }], [{ stateOk: false }]])('is not ready (503) when a required dependency fails: %j', async (options) => {
    const { controller, response } = build(options);
    const result = await controller.ready(response as never);
    expect(result.status).toBe('not_ready');
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('never leaks error text, hosts or credentials', async () => {
    const { controller, response } = build({ db: false, stateOk: false });
    const text = JSON.stringify(await controller.ready(response as never));
    for (const leak of ['hunter2', '10.0.0.5', 'ECONNREFUSED', 'redis://', 'pw@host']) expect(text).not.toContain(leak);
  });
});
