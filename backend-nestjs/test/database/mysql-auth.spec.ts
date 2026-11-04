import { Body, Controller, Get, NotFoundException, Param, Post, Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as mysql from 'mysql2/promise';
import type { Connection } from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { DataSource, type ObjectLiteral } from 'typeorm';
import { MysqlConfig, MYSQL_CONFIG } from '../../src/database/mysql-config';
import { ALL_MIGRATIONS } from '../../src/database/migrations';
import { AuthService, type AuthResult } from '../../src/auth/auth.service';
import { AuthStore } from '../../src/auth/auth-store.service';
import { AuthMailer } from '../../src/auth/auth.mailer';
import { PasswordService } from '../../src/auth/password.service';
import { TokenService, hashOpaqueToken, newPendingToken, newRefreshToken } from '../../src/auth/token.service';
import { CurrentTenant, CurrentUser, IdentityOnly, RequirePermission, RequirePlatform } from '../../src/auth/auth.decorators';
import type { AuthenticatedUser } from '../../src/auth/auth-context';
import { RateLimitService } from '../../src/auth/rate-limit.service';
import { readCorsOptions } from '../../src/auth/cors.config';
import { configureHttpApplication } from '../../src/auth/http.config';
import { tenantContextStore, type TenantContext } from '../../src/common/tenant/tenant-context.store';
import { TenantScopedRepository } from '../../src/common/tenant/tenant-scoped.repository';
import { isUuidv7, newUuidv7, uuidToBinary } from '../../src/common/ids/uuid';
import { AgentRuntimeConfigService, readAgentRuntimeConfig } from '../../src/agent/config/agent-runtime-config.service';

const RUN = process.env.RUN_DB_TESTS === '1' && ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].every((key) => typeof process.env[key] === 'string');
const describeDb = RUN ? describe : describe.skip;
jest.setTimeout(60_000);
const TEST_PASSWORD = 'A test-only long passphrase';

/** Test-only adapter over an EXISTING table, exercising the accepted repository base. */
class SettingsProbeRepository extends TenantScopedRepository<ObjectLiteral> {
  constructor(private readonly source: DataSource) { super(source.getRepository('tenant_settings')); }
  async findOwn(id: string): Promise<boolean> {
    if (!isUuidv7(id)) return false;
    const rows = await this.source.query('SELECT `tenant_id` FROM `tenant_settings` WHERE `tenant_id` = ? AND `tenant_id` = ?', [uuidToBinary(id), uuidToBinary(this.currentTenantId())]) as unknown[];
    return rows.length === 1;
  }
}

/** These probes are registered ONLY by this test module, never in the application. */
@Controller('test/authz')
class AuthProbeController {
  constructor(private readonly source: DataSource) {}
  @Get('tenant')
  async tenant(@CurrentTenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser) {
    await Promise.resolve();
    return { tenantId: tenant.tenantId, userId: user.userId, permissions: tenant.permissions,
      alsTenantId: tenantContextStore.getOrThrow().tenantId, immutable: Object.isFrozen(tenant) && Object.isFrozen(tenant.permissions) };
  }
  @Post('context')
  context(@CurrentTenant() tenant: TenantContext, @Body() _body: unknown) { return { tenantId: tenant.tenantId, permissions: tenant.permissions }; }
  @Get('users') @RequirePermission('users:manage') users() { return { success: true }; }
  @Get('keys') @RequirePermission('api_keys:manage') keys() { return { success: true }; }
  @Get('knowledge-write') @RequirePermission('knowledge:write') knowledge() { return { success: true }; }
  @Get('platform') @RequirePlatform()
  platform(@CurrentUser() user: AuthenticatedUser) { return { role: user.platformRole, hasTenantContext: tenantContextStore.isActive() }; }
  @Get('platform-permission') @RequirePlatform('tenants:write') platformPermission() { return { success: true }; }
  @Get('identity') @IdentityOnly()
  identity(@CurrentUser() user: AuthenticatedUser) { return { userId: user.userId, hasTenantContext: tenantContextStore.isActive() }; }
  @Get('settings/:id')
  async settings(@Param('id') id: string) {
    if (!await new SettingsProbeRepository(this.source).findOwn(id)) throw new NotFoundException();
    return { tenantId: tenantContextStore.getOrThrow().tenantId };
  }
  @Get('isolated')
  async isolated(@CurrentTenant() tenant: TenantContext, @CurrentUser() user: AuthenticatedUser) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await this.source.query('SELECT 1');
    return { tenantId: tenant.tenantId, afterAwait: tenantContextStore.getOrThrow().tenantId, userId: user.userId };
  }
  @Get('unexpected') unexpected() { throw Object.assign(new Error('raw-password raw-refresh-token'), { parameters: ['raw-password-hash'] }); }
}

interface Fixture extends AuthResult { email: string; tenantId: string; sessionId: string }

describeDb('Phase 6C authentication/authorization HTTP integration (real MySQL, Ollama mocked)', () => {
  const stamp = `${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const database = `mczen_6c_auth_${stamp}`;
  const original = { DB_NAME: process.env.DB_NAME, NODE_ENV: process.env.NODE_ENV, MCZEN_ALLOW_DEV_HEADER: process.env.MCZEN_ALLOW_DEV_HEADER, MCZEN_EXPOSE_DEV_AUTH_TOKENS: process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS };
  let admin: Connection;
  let migrator: DataSource;
  let app: INestApplication;
  let store: AuthStore;
  let auth: AuthService;
  let mailer: AuthMailer;
  let created = false;
  let sequence = 0;
  let limiter = new RateLimitService({ env: {} });
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let appliedNames: string[];
  const verificationMailbox = new Map<string, string>();
  const resetMailbox = new Map<string, string>();
  const tokens = new TokenService({ env: { JWT_SECRET: 'mysql-auth-test-only-key-at-least-32-bytes' } });
  const rateProxy = {
    checkEdge: (...args: Parameters<RateLimitService['checkEdge']>) => limiter.checkEdge(...args),
    checkRequest: (...args: Parameters<RateLimitService['checkRequest']>) => limiter.checkRequest(...args),
    checkContext: (...args: Parameters<RateLimitService['checkContext']>) => limiter.checkContext(...args),
  };

  beforeAll(async () => {
    admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    created = true;
    migrator = new DataSource({ ...MysqlConfig.fromEnv({ ...process.env, DB_NAME: database }).toTypeormOptions(ALL_MIGRATIONS), entities: [], logging: false, migrationsTransactionMode: 'each' });
    await migrator.initialize();
    appliedNames = (await migrator.runMigrations()).map((migration) => migration.name);
    process.env.DB_NAME = database;
    process.env.NODE_ENV = 'test';
    mailer = new AuthMailer({}); // Never talks to a configured/user SMTP server.
    jest.spyOn(mailer, 'verification').mockImplementation(async (email, token) => { verificationMailbox.set(email, token); });
    jest.spyOn(mailer, 'passwordReset').mockImplementation((email, token) => { resetMailbox.set(email, token); });
    jest.spyOn(mailer, 'passwordChanged').mockImplementation(() => {});
    // Actual AppModule/TypeOrmModule boot, AFTER the scratch DB environment is set.
    const { AppModule } = await import('../../src/app.module.js');
    const module = await Test.createTestingModule({ imports: [AppModule], controllers: [AuthProbeController] })
      .overrideProvider(AuthMailer).useValue(mailer)
      .overrideProvider(TokenService).useValue(tokens)
      .overrideProvider(RateLimitService).useValue(rateProxy)
      .overrideProvider(AgentRuntimeConfigService).useValue({ values: readAgentRuntimeConfig({}) })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpApplication(app, readCorsOptions({ NODE_ENV: 'test', MCZEN_CORS_ORIGINS: 'https://dashboard.example.test', MCZEN_ALLOW_DEV_HEADER: '1' }));
    // Listen once; concurrent Supertest requests must not each attach listen/close listeners.
    await app.listen(0, '127.0.0.1');
    store = app.get(AuthStore);
    auth = app.get(AuthService);
  });
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.MCZEN_ALLOW_DEV_HEADER = '1';
    delete process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS;
    limiter = new RateLimitService({ env: {} }); // Real quotas; independent windows per test, no disabled limiter.
    verificationMailbox.clear();
    resetMailbox.clear();
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Mock Ollama unavailable.'));
  });
  afterEach(() => fetchMock?.mockRestore());
  afterAll(async () => {
    if (app) await app.close();
    if (migrator?.isInitialized) await migrator.destroy();
    if (admin) {
      if (created) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });

  function registration() {
    sequence++;
    return { email: `user-${sequence}-${stamp}@example.test`, password: TEST_PASSWORD, name: `User ${sequence}`, tenantName: `Tenant ${sequence}`, tenantSlug: `auth-${sequence}-${stamp.replace('_', '-')}` };
  }
  function claims(token: string) {
    const result = tokens.verify(token);
    if (!result.ok) throw new Error('Expected a valid test access token.');
    return result.claims;
  }
  async function fixture(role = 'tenant:owner'): Promise<Fixture> {
    const dto = registration();
    const result = await auth.register(dto, true);
    const tenantId = result.tenants[0].id;
    const sessionId = claims(result.accessToken).sessionId;
    if (role !== 'tenant:owner') await setRole(result.user.id, tenantId, role);
    const active = await auth.activate(result.user.id, sessionId, tenantId);
    return { ...result, accessToken: active.accessToken, activeTenantId: tenantId, email: dto.email, tenantId, sessionId };
  }
  async function setRole(userId: string, tenantId: string, role: string) {
    await store.database.query('UPDATE `tenant_users` SET `role_id` = (SELECT `id` FROM `roles` WHERE `key` = ?) WHERE `user_id` = ? AND `tenant_id` = ?', [role, uuidToBinary(userId), uuidToBinary(tenantId)]);
  }
  async function addMembership(userId: string, tenantId: string, role = 'tenant:viewer') {
    await store.database.query("INSERT INTO `tenant_users` (`id`, `user_id`, `tenant_id`, `role_id`, `status`) SELECT ?, ?, ?, `id`, 'active' FROM `roles` WHERE `key` = ?", [uuidToBinary(newUuidv7()), uuidToBinary(userId), uuidToBinary(tenantId), role]);
  }
  async function invite(tenantId: string, email: string, roleKey = 'tenant:viewer', expired = false): Promise<string> {
    const token = newPendingToken();
    await store.database.query("INSERT INTO `auth_pending_tokens` (`id`, `type`, `token_hash`, `payload`, `expires_at`) VALUES (?, 'invite', ?, ?, ?)",
      [uuidToBinary(newUuidv7()), hashOpaqueToken(token), JSON.stringify({ tenantId, email, roleKey }), new Date(Date.now() + (expired ? -1000 : 86_400_000))]);
    return token;
  }
  const get = (path: string, token: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`);

  it('boots actual Nest/TypeORM DI against the fully migrated scratch schema', async () => {
    expect(appliedNames).toEqual(ALL_MIGRATIONS.map((migration) => migration.name));
    expect(store.database).toBe(app.get(DataSource));
    expect(store.database.isInitialized).toBe(true);
    expect(app.get<MysqlConfig>(MYSQL_CONFIG).view.database).toBe(database);
    expect(store.database.options.logging).toBe(false);
    expect(await migrator.runMigrations()).toHaveLength(0);
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
  it('registers user/workspace/owner/settings/session/pending token atomically with null initial tenancy', async () => {
    const dto = registration();
    const response = await request(app.getHttpServer()).post('/api/auth/register').send(dto).expect(201);
    const result = response.body as AuthResult;
    expect(result.user).toMatchObject({ email: dto.email, displayName: dto.name, emailVerified: false });
    expect(result.activeTenantId).toBeNull();
    expect(claims(result.accessToken).tenantId).toBeNull();
    expect(result.tenants).toHaveLength(1);
    expect(result.tenants[0]).toMatchObject({ role: 'tenant:owner', tenantStatus: 'active' });
    expect(result).not.toHaveProperty('verificationToken');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    const user = await store.findUserById(result.user.id);
    expect(user?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await app.get(PasswordService).verify(user!.passwordHash, dto.password)).toBe(true);
    expect(await new SettingsProbeRepository(store.database).findOwn(newUuidv7()).catch((error: Error) => error.name)).toBe('TenantContextMissingError');
    const settings = await store.database.query('SELECT `tenant_id` FROM `tenant_settings` WHERE `tenant_id` = ?', [uuidToBinary(result.tenants[0].id)]) as unknown[];
    expect(settings).toHaveLength(1);
    const [pending] = await store.database.query("SELECT `token_hash`, `expires_at` FROM `auth_pending_tokens` WHERE `user_id` = ? AND `type` = 'email_verify'", [uuidToBinary(result.user.id)]) as Array<{ token_hash: string; expires_at: Date }>;
    expect(pending.token_hash).toBe(hashOpaqueToken(verificationMailbox.get(dto.email)!));
    expect(pending.expires_at.valueOf() - Date.now()).toBeGreaterThan(23 * 60 * 60_000);
    expect(JSON.stringify(result)).not.toContain(user!.passwordHash);
    await get('/test/authz/tenant', result.accessToken).expect(401);
  });
  it('rolls back duplicate-email/slug registrations without orphaned rows', async () => {
    const existing = await fixture();
    const duplicateEmail = { ...registration(), email: existing.email };
    await request(app.getHttpServer()).post('/api/auth/register').send(duplicateEmail).expect(409);
    expect(await store.database.query('SELECT `id` FROM `tenants` WHERE `slug` = ?', [duplicateEmail.tenantSlug])).toHaveLength(0);
    const duplicateSlug = { ...registration(), tenantSlug: existing.tenants[0].slug };
    await request(app.getHttpServer()).post('/api/auth/register').send(duplicateSlug).expect(409);
    expect(await store.findUserByEmail(duplicateSlug.email)).toBeUndefined();
  });
  it('exposes pending credentials only with explicit non-production direct-loopback opt-in', async () => {
    process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS = '1';
    const local = await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
    expect(local.body.verificationToken).toMatch(/^mzp_/);
    const forwarded = await request(app.getHttpServer()).post('/api/auth/register').set('X-Forwarded-For', '127.0.0.1').send(registration()).expect(201);
    expect(forwarded.body).not.toHaveProperty('verificationToken');
    process.env.NODE_ENV = 'production';
    const availability = jest.spyOn(mailer, 'ensureAvailable').mockImplementation(() => {});
    try {
      const production = await request(app.getHttpServer()).post('/api/auth/register').send(registration()).expect(201);
      expect(production.body).not.toHaveProperty('verificationToken');
    } finally { availability.mockRestore(); }
  });
  it('logs in with single active membership, resets counters, and returns no password/session internals', async () => {
    const f = await fixture();
    await store.database.query('UPDATE `users` SET `failed_login_count` = 3, `login_failure_window_started_at` = ? WHERE `id` = ?', [new Date(), uuidToBinary(f.user.id)]);
    const response = await request(app.getHttpServer()).post('/api/auth/login').send({ email: ` ${f.email.toUpperCase()} `, password: TEST_PASSWORD }).expect(200);
    expect(response.body.activeTenantId).toBe(f.tenantId);
    expect(claims(response.body.accessToken).tenantId).toBe(f.tenantId);
    expect(Object.keys(response.body.user).sort()).toEqual(['displayName', 'email', 'emailVerified', 'id']);
    const [row] = await store.database.query('SELECT `failed_login_count`, `login_failure_window_started_at`, `last_login_at` FROM `users` WHERE `id` = ?', [uuidToBinary(f.user.id)]) as Array<{ failed_login_count: number; login_failure_window_started_at: Date | null; last_login_at: Date | null }>;
    expect(Number(row.failed_login_count)).toBe(0);
    expect(row.login_failure_window_started_at).toBeNull();
    expect(row.last_login_at).toBeInstanceOf(Date);
    await get('/api/auth/me', response.body.accessToken).expect(200);
  });
  it('uses identical 401 responses for wrong, unknown, disabled and locked credentials', async () => {
    const f = await fixture();
    const wrong = await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: 'sensitive wrong password' }).expect(401);
    const unknown = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'unknown@example.test', password: TEST_PASSWORD }).expect(401);
    await store.database.query("UPDATE `users` SET `status` = 'disabled' WHERE `id` = ?", [uuidToBinary(f.user.id)]);
    const disabled = await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: TEST_PASSWORD }).expect(401);
    await store.database.query("UPDATE `users` SET `status` = 'active', `locked_until` = ? WHERE `id` = ?", [new Date(Date.now() + 60_000), uuidToBinary(f.user.id)]);
    const locked = await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: TEST_PASSWORD }).expect(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(disabled.body).toEqual(wrong.body);
    expect(locked.body).toEqual(wrong.body);
    expect(JSON.stringify(wrong.body)).not.toContain('sensitive');
  });
  it('persists the five-failure lockout and escalating cooldown after commit', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: 'wrong test passphrase' }).expect(401);
    let user = await store.findUserById(f.user.id);
    expect(user?.failedLoginCount).toBe(5);
    expect(user?.loginFailureWindowStartedAt).toBeInstanceOf(Date);
    expect(user!.lockedUntil!.valueOf()).toBeGreaterThan(Date.now());
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: TEST_PASSWORD }).expect(401);
    await store.database.query('UPDATE `users` SET `locked_until` = ? WHERE `id` = ?', [new Date(Date.now() - 1000), uuidToBinary(f.user.id)]);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: 'wrong test passphrase' }).expect(401);
    user = await store.findUserById(f.user.id);
    expect(user?.failedLoginCount).toBe(6);
    expect(user!.lockedUntil!.valueOf() - Date.now()).toBeGreaterThan(115_000);
  });
  it('starts a fresh failure window after 15 minutes instead of locking on lifetime failures', async () => {
    const f = await fixture();
    await store.database.query('UPDATE `users` SET `failed_login_count` = 4, `login_failure_window_started_at` = ? WHERE `id` = ?', [new Date(Date.now() - 16 * 60_000), uuidToBinary(f.user.id)]);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: 'wrong test passphrase' }).expect(401);
    const user = await store.findUserById(f.user.id);
    expect(user?.failedLoginCount).toBe(1);
    expect(user?.lockedUntil).toBeNull();
  });
  it('does not accept a password verified against a digest replaced during login', async () => {
    const f = await fixture();
    const passwords = app.get(PasswordService);
    const replacement = await passwords.hash('Replacement test passphrase');
    const verify = jest.spyOn(passwords, 'verify').mockImplementationOnce(async () => {
      await store.database.query('UPDATE `users` SET `password_hash` = ? WHERE `id` = ?', [replacement, uuidToBinary(f.user.id)]);
      return true;
    });
    try { await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: TEST_PASSWORD }).expect(401); }
    finally { verify.mockRestore(); }
  });
  it('requires explicit multi-tenant selection, returns only memberships, and rejects stale access after switching', async () => {
    const a = await fixture();
    const b = await fixture();
    await addMembership(a.user.id, b.tenantId);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: a.email, password: TEST_PASSWORD }).expect(200);
    expect(login.body.activeTenantId).toBeNull();
    expect(login.body.tenants.map((tenant: { id: string }) => tenant.id).sort()).toEqual([a.tenantId, b.tenantId].sort());
    await get('/test/authz/tenant', login.body.accessToken).set('x-mczen-tenant-id', 'tenant-a').expect(401);
    const activated = await post(`/api/auth/tenants/${b.tenantId}/activate`, login.body.accessToken).send({}).expect(200);
    expect(claims(activated.body.accessToken).tenantId).toBe(b.tenantId);
    expect(activated.body.permissions).not.toContain('users:manage');
    await get('/test/authz/tenant', login.body.accessToken).expect(409);
    await get('/api/auth/me', login.body.accessToken).expect(409);
    const refreshed = await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    expect(claims(refreshed.body.accessToken).tenantId).toBe(b.tenantId);
    const me = await get('/api/auth/me', refreshed.body.accessToken).expect(200);
    expect(me.body.activeTenantId).toBe(b.tenantId);
    expect(me.body.tenants).toHaveLength(2);
  });
  it('returns identical 404s for foreign, unknown and malformed activation targets', async () => {
    const a = await fixture();
    const b = await fixture();
    const foreign = await post(`/api/auth/tenants/${b.tenantId}/activate`, a.accessToken).send({}).expect(404);
    const unknown = await post(`/api/auth/tenants/${newUuidv7()}/activate`, a.accessToken).send({}).expect(404);
    const malformed = await post('/api/auth/tenants/not-an-id/activate', a.accessToken).send({}).expect(404);
    expect(foreign.body).toEqual(unknown.body);
    expect(foreign.body).toEqual(malformed.body);
  });
  it('enforces tenant-admin/owner permissions and immediate role changes without JWT role claims', async () => {
    const adminUser = await fixture('tenant:admin');
    const owner = await fixture();
    await get('/test/authz/users', adminUser.accessToken).expect(200);
    await get('/test/authz/keys', adminUser.accessToken).expect(403);
    await get('/test/authz/keys', owner.accessToken).expect(200);
    await setRole(adminUser.user.id, adminUser.tenantId, 'tenant:viewer');
    await get('/test/authz/users', adminUser.accessToken).expect(403);
    const me = await get('/api/auth/me', adminUser.accessToken).expect(200);
    expect(me.body.permissions).not.toContain('users:manage');
    expect(me.body.tenants[0].role).toBe('tenant:viewer');
  });
  it('re-reads role_permissions from MySQL on every tenant request', async () => {
    const f = await fixture('tenant:editor');
    await get('/test/authz/knowledge-write', f.accessToken).expect(200);
    await store.database.query("DELETE rp FROM `role_permissions` rp JOIN `roles` r ON r.`id` = rp.`role_id` JOIN `permissions` p ON p.`id` = rp.`permission_id` WHERE r.`key` = 'tenant:editor' AND p.`key` = 'knowledge:write'");
    try { await get('/test/authz/knowledge-write', f.accessToken).expect(403); }
    finally { await store.database.query("INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`) SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p WHERE r.`key` = 'tenant:editor' AND p.`key` = 'knowledge:write'"); }
  });
  it('requires a reserved platform DB grant, grants no wildcard, and establishes no tenant bypass', async () => {
    const owner = await fixture();
    const adminUser = await fixture('tenant:admin');
    const platform = await fixture('platform:admin');
    await get('/test/authz/platform', owner.accessToken).expect(403);
    await get('/test/authz/platform', adminUser.accessToken).expect(403);
    const allowed = await get('/test/authz/platform', platform.accessToken).expect(200);
    expect(allowed.body).toEqual({ role: 'platform:admin', hasTenantContext: false });
    await get('/test/authz/platform-permission', platform.accessToken).expect(403); // seed grants zero, not all
    await get('/test/authz/users', platform.accessToken).expect(403);
    await post(`/api/auth/tenants/${owner.tenantId}/activate`, platform.accessToken).send({}).expect(404);
    await store.database.query("UPDATE `tenant_users` SET `status` = 'removed' WHERE `user_id` = ?", [uuidToBinary(platform.user.id)]);
    await get('/test/authz/platform', platform.accessToken).expect(403);
  });
  it('ignores cross-tenant header/body/query overrides and enforces repository IDOR predicates', async () => {
    const a = await fixture();
    const b = await fixture();
    const context = await post(`/test/authz/context?tenantId=${b.tenantId}`, a.accessToken)
      .set('x-mczen-tenant-id', b.tenantId).send({ tenantId: b.tenantId, permissions: ['platform:all'], userId: b.user.id }).expect(201);
    expect(context.body.tenantId).toBe(a.tenantId);
    expect(context.body.permissions).not.toContain('platform:all');
    await get(`/test/authz/settings/${a.tenantId}`, a.accessToken).expect(200);
    const foreign = await get(`/test/authz/settings/${b.tenantId}`, a.accessToken).expect(404);
    const unknown = await get(`/test/authz/settings/${newUuidv7()}`, a.accessToken).expect(404);
    expect(foreign.body).toEqual(unknown.body);
  });
  it.each(['invited', 'suspended', 'removed', 'deleted'])('rejects %s memberships immediately while identity/logout remain available', async (status) => {
    const f = await fixture();
    if (status === 'deleted') await store.database.query('DELETE FROM `tenant_users` WHERE `user_id` = ?', [uuidToBinary(f.user.id)]);
    else await store.database.query('UPDATE `tenant_users` SET `status` = ? WHERE `user_id` = ?', [status, uuidToBinary(f.user.id)]);
    await get('/test/authz/tenant', f.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }).expect(401);
    const me = await get('/api/auth/me', f.accessToken).expect(200);
    expect(me.body.activeTenantId).toBeNull();
    expect(me.body.tenants).toHaveLength(0);
    await post('/api/auth/logout', f.accessToken).send({}).expect(200);
  });
  it.each(['suspended', 'closed', 'soft-deleted'])('rejects %s tenants with neutral 403, without blocking sign-out', async (status) => {
    const f = await fixture();
    if (status === 'soft-deleted') await store.database.query('UPDATE `tenants` SET `deleted_at` = ? WHERE `id` = ?', [new Date(), uuidToBinary(f.tenantId)]);
    else await store.database.query('UPDATE `tenants` SET `status` = ? WHERE `id` = ?', [status, uuidToBinary(f.tenantId)]);
    await get('/test/authz/tenant', f.accessToken).expect(403);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }).expect(403);
    await post(`/api/auth/tenants/${f.tenantId}/activate`, f.accessToken).send({}).expect(403);
    const me = await get('/api/auth/me', f.accessToken).expect(200);
    expect(me.body.activeTenantId).toBeNull();
    await post('/api/auth/logout', f.accessToken).send({}).expect(200);
  });
  it.each(['disabled', 'erased'])('rejects %s users for existing access and refresh tokens', async (status) => {
    const f = await fixture();
    await store.database.query('UPDATE `users` SET `status` = ? WHERE `id` = ?', [status, uuidToBinary(f.user.id)]);
    await get('/test/authz/tenant', f.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }).expect(401);
  });
  it('rejects expired JWTs, foreign session binding and cross-class bearer credentials generically', async () => {
    const a = await fixture();
    const b = await fixture();
    const expired = tokens.sign({ userId: a.user.id, sessionId: a.sessionId, tenantId: a.tenantId }, Date.now() - 900_000);
    const wrongBinding = tokens.sign({ userId: a.user.id, sessionId: b.sessionId, tenantId: b.tenantId });
    const bad = await get('/test/authz/tenant', expired).expect(401);
    expect((await get('/test/authz/tenant', wrongBinding).expect(401)).body).toEqual(bad.body);
    expect((await get('/test/authz/tenant', a.refreshToken).expect(401)).body).toEqual(bad.body);
    expect((await get('/test/authz/tenant', 'wgt_test-credential').expect(401)).body).toEqual(bad.body);
  });
  it('token_version changes kill both token classes even before session rows are marked revoked', async () => {
    const f = await fixture();
    await store.database.query('UPDATE `users` SET `token_version` = `token_version` + 1 WHERE `id` = ?', [uuidToBinary(f.user.id)]);
    await get('/api/auth/me', f.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }).expect(401);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: TEST_PASSWORD }).expect(200);
    expect((await store.findSession(claims(login.body.accessToken).sessionId))?.tokenVersion).toBe(2);
    await get('/test/authz/tenant', login.body.accessToken).expect(200);
  });
  it.each(['revoked', 'expired', 'deleted'])('rejects an independently %s session', async (state) => {
    const f = await fixture();
    if (state === 'deleted') await store.database.query('DELETE FROM `user_sessions` WHERE `id` = ?', [uuidToBinary(f.sessionId)]);
    else if (state === 'expired') await store.database.query('UPDATE `user_sessions` SET `expires_at` = ? WHERE `id` = ?', [new Date(Date.now() - 1000), uuidToBinary(f.sessionId)]);
    else await store.database.query("UPDATE `user_sessions` SET `revoked_at` = ?, `revoked_reason` = 'logout' WHERE `id` = ?", [new Date(), uuidToBinary(f.sessionId)]);
    await get('/api/auth/me', f.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }).expect(401);
  });
  it('rotates refresh tokens once, stores only SHA-256, and preserves the absolute family/session horizon', async () => {
    const f = await fixture();
    const before = (await store.findSession(f.sessionId))!.expiresAt.valueOf();
    const rotated = await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }).expect(200);
    expect(Object.keys(rotated.body).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken']);
    expect(rotated.body.refreshToken).not.toBe(f.refreshToken);
    const rows = await store.database.query('SELECT `id`, `token_hash`, `family_id`, `used_at`, `replaced_by`, `expires_at` FROM `refresh_tokens` WHERE `session_id` = ?', [uuidToBinary(f.sessionId)]) as Array<{ id: Buffer; token_hash: string; family_id: Buffer; used_at: Date | null; replaced_by: Buffer | null; expires_at: Date }>;
    expect(rows).toHaveLength(2);
    const old = rows.find((row) => row.token_hash === hashOpaqueToken(f.refreshToken))!;
    const successor = rows.find((row) => row.token_hash === hashOpaqueToken(rotated.body.refreshToken))!;
    expect(old.used_at).toBeInstanceOf(Date);
    expect(old.replaced_by?.equals(successor.id)).toBe(true);
    expect(successor.replaced_by).toBeNull();
    expect(old.family_id.equals(successor.family_id)).toBe(true);
    expect(successor.expires_at.valueOf()).toBe(before);
    expect((await store.findSession(f.sessionId))!.expiresAt.valueOf()).toBe(before);
    expect(JSON.stringify(rows)).not.toContain(f.refreshToken);
    await get('/test/authz/tenant', rotated.body.accessToken).expect(200);
  });
  it('commits refresh reuse quarantine for the entire family, but not other device sessions', async () => {
    const f = await fixture();
    const otherDevice = await auth.login({ email: f.email, password: TEST_PASSWORD });
    const rotated = await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }).expect(401);
    const session = await store.findSession(f.sessionId);
    expect(session?.revokedAt).toBeInstanceOf(Date);
    const rows = await store.database.query('SELECT `revoked_at` FROM `refresh_tokens` WHERE `session_id` = ?', [uuidToBinary(f.sessionId)]) as Array<{ revoked_at: Date | null }>;
    expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
    await get('/api/auth/me', rotated.body.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
    await get('/api/auth/me', otherDevice.accessToken).expect(200);
  });
  it('serializes concurrent refreshes: one rotation, one reuse failure, durable quarantine', async () => {
    const f = await fixture();
    const responses = await Promise.all([0, 1].map(() => request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken })));
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 401]);
    const successful = responses.find((response) => response.status === 200)!;
    await get('/api/auth/me', successful.body.accessToken).expect(401);
    expect((await store.findSession(f.sessionId))?.revokedAt).toBeInstanceOf(Date);
  });
  it('current-session logout ignores a foreign refresh-token selector and revokes access immediately', async () => {
    const a = await fixture();
    const b = await fixture();
    await post('/api/auth/logout', a.accessToken).send({ refreshToken: b.refreshToken }).expect(200);
    await get('/api/auth/me', a.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: b.refreshToken }).expect(200);
  });
  it('serializes refresh against logout without leaving a usable successor session', async () => {
    const f = await fixture();
    const [refresh, logout] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: f.refreshToken }),
      post('/api/auth/logout', f.accessToken).send({}),
    ]);
    expect(logout.status).toBe(200);
    expect([200, 401]).toContain(refresh.status);
    expect((await store.findSession(f.sessionId))?.revokedAt).toBeInstanceOf(Date);
    await get('/api/auth/me', f.accessToken).expect(401);
    if (refresh.status === 200) {
      await get('/api/auth/me', refresh.body.accessToken).expect(401);
      await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: refresh.body.refreshToken }).expect(401);
    }
  });
  it.each(['unknown', 'expired', 'revoked'])('rejects an independently %s refresh token without rotating or extending its session', async (state) => {
    const f = await fixture();
    const before = (await store.findSession(f.sessionId))!.expiresAt.valueOf();
    if (state === 'expired') await store.database.query('UPDATE `refresh_tokens` SET `expires_at` = ? WHERE `token_hash` = ?', [new Date(Date.now() - 1000), hashOpaqueToken(f.refreshToken)]);
    if (state === 'revoked') await store.database.query('UPDATE `refresh_tokens` SET `revoked_at` = ? WHERE `token_hash` = ?', [new Date(), hashOpaqueToken(f.refreshToken)]);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: state === 'unknown' ? newRefreshToken() : f.refreshToken }).expect(401);
    expect((await store.findSession(f.sessionId))!.expiresAt.valueOf()).toBe(before);
    expect(await store.database.query('SELECT `id` FROM `refresh_tokens` WHERE `session_id` = ?', [uuidToBinary(f.sessionId)])).toHaveLength(1);
    await get('/api/auth/me', f.accessToken).expect(200);
  });
  it('all-session logout increments token_version and leaves other users untouched', async () => {
    const a = await fixture();
    const second = await auth.login({ email: a.email, password: TEST_PASSWORD });
    const b = await fixture();
    await post('/api/auth/logout', a.accessToken).send({ allSessions: true }).expect(200);
    expect((await store.findUserById(a.user.id))?.tokenVersion).toBe(2);
    await get('/api/auth/me', second.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: second.refreshToken }).expect(401);
    await get('/api/auth/me', b.accessToken).expect(200);
  });
  it('forgot-password has one response for known, unknown, malformed and disabled mailboxes', async () => {
    const f = await fixture();
    const known = await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: f.email }).expect(200);
    const unknown = await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'unknown-reset@example.test' }).expect(200);
    const malformed = await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'bad' }).expect(200);
    await store.database.query("UPDATE `users` SET `status` = 'disabled' WHERE `id` = ?", [uuidToBinary(f.user.id)]);
    const disabled = await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: f.email }).expect(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body).toEqual(malformed.body);
    expect(known.body).toEqual(disabled.body);
    expect(known.body).not.toHaveProperty('resetToken');
  });
  it('production unconfigured SMTP fails uniformly before register/forgot-password identity lookup', async () => {
    const f = await fixture();
    process.env.NODE_ENV = 'production';
    process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS = '1';
    const known = await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: f.email }).expect(503);
    const unknown = await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'unknown-prod@example.test' }).expect(503);
    expect(known.body).toEqual(unknown.body);
    const dto = registration();
    await request(app.getHttpServer()).post('/api/auth/register').send(dto).expect(503);
    expect(await store.findUserByEmail(dto.email)).toBeUndefined();
    expect(resetMailbox.size).toBe(0);
  });
  it('uses a hashed 60-minute single-use reset to replace the password and revoke every session/reset link', async () => {
    const f = await fixture();
    const second = await auth.login({ email: f.email, password: TEST_PASSWORD });
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: f.email }).expect(200);
    const firstToken = resetMailbox.get(f.email)!;
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: f.email }).expect(200);
    const token = resetMailbox.get(f.email)!;
    const [pending] = await store.database.query('SELECT `expires_at`, `token_hash` FROM `auth_pending_tokens` WHERE `token_hash` = ?', [hashOpaqueToken(token)]) as Array<{ expires_at: Date; token_hash: string }>;
    expect(pending.expires_at.valueOf() - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(pending.token_hash).not.toBe(token);
    const newPassword = 'Replacement test-only passphrase';
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, newPassword }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, newPassword }).expect(401);
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token: firstToken, newPassword }).expect(401);
    const user = await store.findUserById(f.user.id);
    expect(user?.tokenVersion).toBe(2);
    expect(await app.get(PasswordService).verify(user!.passwordHash, newPassword)).toBe(true);
    expect(await app.get(PasswordService).verify(user!.passwordHash, TEST_PASSWORD)).toBe(false);
    await get('/api/auth/me', f.accessToken).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: second.refreshToken }).expect(401);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: newPassword }).expect(200);
    expect(mailer.passwordChanged).toHaveBeenCalledWith(f.email);
  });
  it('verifies email once and rejects expired or wrong-purpose pending credentials', async () => {
    const f = await fixture();
    const verification = verificationMailbox.get(f.email)!;
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token: verification, newPassword: TEST_PASSWORD }).expect(401);
    await request(app.getHttpServer()).post('/api/auth/verify-email').send({ token: verification }).expect(200);
    expect((await get('/api/auth/me', f.accessToken).expect(200)).body.user.emailVerified).toBe(true);
    await request(app.getHttpServer()).post('/api/auth/verify-email').send({ token: verification }).expect(401);
    const expiredUser = await fixture();
    const expired = verificationMailbox.get(expiredUser.email)!;
    await store.database.query('UPDATE `auth_pending_tokens` SET `expires_at` = ? WHERE `token_hash` = ?', [new Date(Date.now() - 1000), hashOpaqueToken(expired)]);
    await request(app.getHttpServer()).post('/api/auth/verify-email').send({ token: expired }).expect(401);
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token: verification, newPassword: TEST_PASSWORD }).expect(401);
    await request(app.getHttpServer()).post('/api/auth/refresh').send({ refreshToken: verification }).expect(401);
  });
  it('rejects expired resets and unused credentials from the wrong pending-token purpose', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: f.email }).expect(200);
    const reset = resetMailbox.get(f.email)!;
    await request(app.getHttpServer()).post('/api/auth/verify-email').send({ token: reset }).expect(401);
    await store.database.query('UPDATE `auth_pending_tokens` SET `expires_at` = ? WHERE `token_hash` = ?', [new Date(Date.now() - 1000), hashOpaqueToken(reset)]);
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token: reset, newPassword: TEST_PASSWORD }).expect(401);
    expect((await store.findUserById(f.user.id))?.tokenVersion).toBe(1);
    await get('/api/auth/me', f.accessToken).expect(200);
  });
  it('allows a concurrent password reset only once, with one version bump and durable revocation', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: f.email }).expect(200);
    const token = resetMailbox.get(f.email)!;
    const responses = await Promise.all([0, 1].map(() => request(app.getHttpServer()).post('/api/auth/reset-password').send({ token, newPassword: 'Concurrent replacement passphrase' })));
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 401]);
    expect((await store.findUserById(f.user.id))?.tokenVersion).toBe(2);
    await get('/api/auth/me', f.accessToken).expect(401);
  });
  it('joins an invited mailbox/tenant/role binding atomically without creating a new workspace', async () => {
    const existing = await fixture();
    const dto = registration();
    const token = await invite(existing.tenantId, dto.email);
    const response = await request(app.getHttpServer()).post('/api/auth/register').send({ email: dto.email, password: TEST_PASSWORD, invite_token: token }).expect(201);
    expect(response.body.tenants).toHaveLength(1);
    expect(response.body.tenants[0]).toMatchObject({ id: existing.tenantId, role: 'tenant:viewer' });
    expect(response.body.activeTenantId).toBeNull();
    const [pending] = await store.database.query('SELECT `used_at` FROM `auth_pending_tokens` WHERE `token_hash` = ?', [hashOpaqueToken(token)]) as Array<{ used_at: Date | null }>;
    expect(pending.used_at).toBeInstanceOf(Date);
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: dto.email, password: TEST_PASSWORD, inviteToken: token }).expect(401);
  });
  it.each(['wrong-mailbox', 'platform-role', 'expired'])('rejects an invite with %s binding/state without creating a user', async (kind) => {
    const existing = await fixture();
    const dto = registration();
    const token = await invite(existing.tenantId, kind === 'wrong-mailbox' ? 'other-mailbox@example.test' : dto.email, kind === 'platform-role' ? 'platform:admin' : 'tenant:viewer', kind === 'expired');
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: dto.email, password: TEST_PASSWORD, inviteToken: token }).expect(401);
    expect(await store.findUserByEmail(dto.email)).toBeUndefined();
  });
  it('rate-limits login attempts with generic 429/Retry-After before further database/hash work', async () => {
    const f = await fixture();
    for (let i = 0; i < 10; i++) await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: 'wrong test passphrase' }).expect(401);
    const limited = await request(app.getHttpServer()).post('/api/auth/login').send({ email: f.email, password: 'wrong test passphrase' }).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body.message).toBe('Too many requests.');
    expect(limited.body).not.toHaveProperty('email');
  });
  it('rate-limits at the actual HTTP edge before JSON parsing, even on unknown paths', async () => {
    limiter = new RateLimitService({ env: { MCZEN_RATE_IP_PER_MINUTE: '1' } });
    await request(app.getHttpServer()).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad-json').expect(400);
    const denied = await request(app.getHttpServer()).get('/not-a-route').set('X-Forwarded-For', '203.0.113.99').expect(429);
    expect(denied.headers['retry-after']).toBeDefined();
    expect(denied.headers['cache-control']).toBe('no-store');
  });
  it('throttles session activity writes without extending the absolute session expiry', async () => {
    const f = await fixture();
    const before = (await store.findSession(f.sessionId))!.expiresAt.valueOf();
    await store.database.query('UPDATE `user_sessions` SET `last_seen_at` = ? WHERE `id` = ?', [new Date(Date.now() - 120_000), uuidToBinary(f.sessionId)]);
    await get('/api/auth/me', f.accessToken).expect(200);
    const [first] = await store.database.query('SELECT `last_seen_at` FROM `user_sessions` WHERE `id` = ?', [uuidToBinary(f.sessionId)]) as Array<{ last_seen_at: Date }>;
    expect(Date.now() - first.last_seen_at.valueOf()).toBeLessThan(10_000);
    await get('/api/auth/me', f.accessToken).expect(200);
    const [second] = await store.database.query('SELECT `last_seen_at` FROM `user_sessions` WHERE `id` = ?', [uuidToBinary(f.sessionId)]) as Array<{ last_seen_at: Date }>;
    expect(second.last_seen_at.valueOf()).toBe(first.last_seen_at.valueOf());
    expect((await store.findSession(f.sessionId))!.expiresAt.valueOf()).toBe(before);
  });
  it('production ignores the development header while valid JWT requests remain DB-authorized', async () => {
    const f = await fixture();
    process.env.NODE_ENV = 'production';
    await request(app.getHttpServer()).get('/api/agent/tools').set('x-mczen-tenant-id', 'tenant-a').expect(401);
    const verified = await get('/test/authz/tenant', f.accessToken).set('x-mczen-tenant-id', 'tenant-b').expect(200);
    expect(verified.body.tenantId).toBe(f.tenantId);
  });
  it('propagates immutable context across concurrent Nest/RxJS/DB awaits without cross-request leakage', async () => {
    const a = await fixture();
    const b = await fixture();
    const inputs = Array.from({ length: 12 }, (_, index) => index % 2 ? a : b);
    const responses = await Promise.all(inputs.map((f) => get('/test/authz/isolated', f.accessToken)));
    responses.forEach((response, index) => {
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ tenantId: inputs[index].tenantId, afterAwait: inputs[index].tenantId, userId: inputs[index].user.id });
    });
    expect((await get('/test/authz/tenant', a.accessToken).expect(200)).body.immutable).toBe(true);
    expect((await get('/test/authz/identity', a.accessToken).expect(200)).body.hasTenantContext).toBe(false);
    expect(tenantContextStore.get()).toBeUndefined();
    await request(app.getHttpServer()).get('/test/authz/tenant').expect(401);
  });
  it('preserves the Phase 5 agent response contract with authenticated context and Ollama mocked', async () => {
    const f = await fixture();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: 'assistant', content: 'Hello from the authenticated agent.' } })));
    const response = await post('/api/agent/ask', f.accessToken).set('x-mczen-tenant-id', 'tenant-b').send({ question: 'hello', tenantId: 'tenant-b', permissions: ['admin:all'] }).expect(201);
    expect(Object.keys(response.body).sort()).toEqual(['answer', 'model', 'sources', 'success', 'toolCalls']);
    expect(response.body.success).toBe(true);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect((await get('/api/agent/tools', f.accessToken).expect(200)).body).not.toHaveProperty('resolvedDevTenant');
  });
  it('enforces exact HTTP CORS origins/preflight without credential cookies', async () => {
    const allowed = await request(app.getHttpServer()).get('/api/health').set('Origin', 'https://dashboard.example.test').expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://dashboard.example.test');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    const denied = await request(app.getHttpServer()).get('/api/health').set('Origin', 'https://attacker.example.test').expect(403);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app.getHttpServer()).options('/api/auth/login').set('Origin', 'https://dashboard.example.test').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type').expect(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
  });
  it('sanitizes unexpected provider and malformed/oversized JSON errors without logging secret material', async () => {
    const f = await fixture();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const failure = await get('/test/authz/unexpected', f.accessToken).expect(500);
      expect(JSON.stringify(failure.body)).not.toContain('raw-password');
      expect(JSON.stringify(log.mock.calls)).not.toContain('raw-password');
      const malformed = await request(app.getHttpServer()).post('/api/auth/login').set('Content-Type', 'application/json').send('{"password":"raw-password", bad-json').expect(400);
      expect(JSON.stringify(malformed.body)).not.toContain('raw-password');
      const large = await request(app.getHttpServer()).post('/api/auth/login').send({ password: 'raw-password'.repeat(12_000) }).expect(413);
      expect(JSON.stringify(large.body)).not.toContain('raw-password');
    } finally { log.mockRestore(); }
  });
});
