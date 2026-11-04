import { DataSource } from 'typeorm';
import { loadOptionalDotEnv, MysqlConfig } from '../src/database/mysql-config';
import { AuthMailer } from '../src/auth/auth.mailer';
import { AuthService } from '../src/auth/auth.service';
import { AuthStore } from '../src/auth/auth-store.service';
import { PasswordService } from '../src/auth/password.service';
import { TokenService } from '../src/auth/token.service';
import { hashOpaqueToken, newPendingToken } from '../src/auth/token.service';
import { binaryToUuid, newUuidv7, uuidToBinary } from '../src/common/ids/uuid';
import { DEMO_MEMBER_EMAIL, DEMO_MEMBER_PASSWORD, DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from './demo-owner-seed.credentials';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const DEMO_DATABASE = /(?:^|[_-])(test|testing|dev|development|demo|local)(?:$|[_-])/i;
const APPROVED_LOCAL_DATABASES = new Set(['mczen']);

async function main(): Promise<void> {
  loadOptionalDotEnv();

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seeding is disabled when NODE_ENV=production.');
  }

  const config = MysqlConfig.fromEnv();
  if (!LOCAL_HOSTS.has(config.view.host.toLowerCase()) ||
    (!DEMO_DATABASE.test(config.view.database) && !APPROVED_LOCAL_DATABASES.has(config.view.database))) {
    throw new Error('Refusing to seed: use an approved local demo database.');
  }

  const dataSource = new DataSource({
    ...config.toTypeormOptions(),
    entities: [],
    migrations: [],
    migrationsRun: false,
    logging: false,
  });
  const mailer = new AuthMailer();

  try {
    await dataSource.initialize();
    const [identity] = await dataSource.query(
      'SELECT DATABASE() AS databaseName, @@hostname AS serverName',
    ) as Array<{ databaseName: string | null; serverName: string }>;
    if (identity?.databaseName !== config.view.database) {
      throw new Error('Refusing to seed: connected database does not match the configured local demo database.');
    }

    if (process.argv.includes('--owner') || process.argv.includes('--member')) {
      if (process.argv.includes('--owner') && process.argv.includes('--member')) {
        throw new Error('Choose either --owner or --member, not both.');
      }
      const member = process.argv.includes('--member');
      const email = member ? DEMO_MEMBER_EMAIL : DEMO_OWNER_EMAIL;
      const password = member ? DEMO_MEMBER_PASSWORD : DEMO_OWNER_PASSWORD;
      const roleKey = member ? 'tenant:member' : 'tenant:owner';
      const store = new AuthStore(dataSource);
      if (await store.findUserByEmail(email)) {
        throw new Error('Demo email already exists; no account was overwritten.');
      }
      const tenants = await dataSource.query(
        "SELECT `id` FROM `tenants` WHERE `slug` = ? AND `status` = 'active' AND `deleted_at` IS NULL",
        ['mczen'],
      ) as Array<{ id: Buffer }>;
      if (tenants.length !== 1) throw new Error('Expected the existing active mczen workspace.');
      const tenantId = binaryToUuid(tenants[0].id);
      const invite = newPendingToken();
      const inviteId = uuidToBinary(newUuidv7());
      const tokens = new TokenService();
      const auth = new AuthService(store, new PasswordService(), tokens, mailer);
      await dataSource.query(
        'INSERT INTO `auth_pending_tokens` (`id`, `type`, `token_hash`, `payload`, `expires_at`) VALUES (?, ?, ?, ?, ?)',
        [inviteId, 'invite', hashOpaqueToken(invite),
          JSON.stringify({ tenantId, roleKey, email }),
          new Date(Date.now() + 10 * 60_000)],
      );
      try {
        const owner = await auth.register({
          email, password,
          name: member ? 'McZEN Demo User' : 'McZEN Demo Owner', inviteToken: invite,
        });
        const membership = await store.findMembership(owner.user.id, tenantId);
        const permissions = membership ? await store.rolePermissions(membership.roleId) : [];
        const managementPermissions = ['assistants:write', 'knowledge:write', 'tools:write', 'users:manage'];
        const expectedPermissions = member
          ? permissions.includes('conversations:write') && managementPermissions.every((key) => !permissions.includes(key))
          : managementPermissions.every((key) => permissions.includes(key));
        if (membership?.roleKey !== roleKey || !expectedPermissions ||
          await store.platformRole(owner.user.id) !== undefined) {
          throw new Error('Account was registered, but workspace permission verification failed.');
        }
        const login = await auth.login({ email, password });
        const claims = tokens.verify(login.accessToken);
        if (!claims.ok || login.activeTenantId !== tenantId) throw new Error('Demo login verification failed.');
        await auth.logout(owner.user.id, claims.claims.sessionId, { allSessions: true });
        console.log(`Demo ${roleKey} created; login and tenant permissions verified.`);
        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);
        console.log('Workspace: McZEN Demo (mczen). Sign in WITHOUT the Platform administrator checkbox.');
      } finally {
        await dataSource.query('DELETE FROM `auth_pending_tokens` WHERE `id` = ?', [inviteId]);
      }
      return;
    }

    const existingUsers = await dataSource.query(
      'SELECT `id` FROM `users` WHERE `email` = ? LIMIT 1',
      [PLATFORM_ADMIN_EMAIL],
    ) as Array<{ id: Buffer }>;
    const existingTenants = await dataSource.query(
      'SELECT `id` FROM `tenants` WHERE `slug` = ? LIMIT 1',
      ['mczen'],
    ) as Array<{ id: Buffer }>;
    if (existingUsers.length || existingTenants.length) {
      throw new Error('Demo account or workspace already exists; no changes were made.');
    }

    const platformRoles = await dataSource.query(
      'SELECT `id` FROM `roles` WHERE `key` = ? AND `is_platform` = 1 LIMIT 1',
      ['platform:admin'],
    ) as Array<{ id: number }>;
    if (!platformRoles[0]) {
      throw new Error('Platform admin role is unavailable. Check that the local database migrations are applied.');
    }

    const tokens = new TokenService();
    const auth = new AuthService(new AuthStore(dataSource), new PasswordService(), tokens, mailer);
    const result = await auth.register({
      email: PLATFORM_ADMIN_EMAIL,
      password: PLATFORM_ADMIN_PASSWORD,
      name: 'McZEN Demo Admin',
      tenantName: 'McZEN Demo',
      tenantSlug: 'mczen',
    });

    if (result.user.email !== PLATFORM_ADMIN_EMAIL) {
      throw new Error('Seed result could not be verified. Check the local database before retrying.');
    }

    const claims = tokens.verify(result.accessToken);
    if (!claims.ok) {
      throw new Error('Could not verify the temporary registration session.');
    }
    await auth.logout(result.user.id, claims.claims.sessionId, { allSessions: true });

    const membership = await dataSource.query(
      `SELECT tu.\`id\` AS membershipId, r.\`id\` AS roleId
       FROM \`tenant_users\` tu
       JOIN \`users\` u ON u.\`id\` = tu.\`user_id\`
       JOIN \`tenants\` t ON t.\`id\` = tu.\`tenant_id\`
       JOIN \`roles\` r ON r.\`key\` = 'platform:admin' AND r.\`is_platform\` = 1
       WHERE u.\`email\` = ? AND t.\`slug\` = ? AND tu.\`status\` = 'active'
       LIMIT 1`,
      [PLATFORM_ADMIN_EMAIL, 'mczen'],
    ) as Array<{ membershipId: Buffer; roleId: number }>;
    if (!membership[0]) {
      throw new Error('Registered demo account membership could not be found.');
    }

    await dataSource.transaction(async (manager) => {
      const update = await manager.query(
        'UPDATE `tenant_users` SET `role_id` = ? WHERE `id` = ? AND `status` = ?',
        [membership[0].roleId, membership[0].membershipId, 'active'],
      ) as { affectedRows?: number };
      if (update.affectedRows !== 1) {
        throw new Error('Could not assign the platform admin role to the demo account.');
      }
    });

    const [verifiedRole] = await dataSource.query(
      `SELECT r.\`key\` AS roleKey, r.\`is_platform\` AS isPlatform
       FROM \`tenant_users\` tu
       JOIN \`users\` u ON u.\`id\` = tu.\`user_id\`
       JOIN \`tenants\` t ON t.\`id\` = tu.\`tenant_id\`
       JOIN \`roles\` r ON r.\`id\` = tu.\`role_id\`
       WHERE u.\`email\` = ? AND t.\`slug\` = ? AND tu.\`status\` = 'active'
       LIMIT 1`,
      [PLATFORM_ADMIN_EMAIL, 'mczen'],
    ) as Array<{ roleKey: string; isPlatform: number }>;
    if (verifiedRole?.roleKey !== 'platform:admin' || Number(verifiedRole.isPlatform) !== 1) {
      throw new Error('Platform role assignment could not be verified.');
    }

    console.log('Local demo platform administrator created.');
    console.log(`Email: ${PLATFORM_ADMIN_EMAIL}`);
    console.log(`Password: ${PLATFORM_ADMIN_PASSWORD}`);
    console.log('Workspace: McZEN Demo (mczen)');
    console.log('Role: platform administrator');
    console.log(`Database: ${identity.databaseName} on local MySQL (${identity.serverName})`);
    console.warn('Demo credentials are fixed and must never be used outside an isolated local demo database.');
  } finally {
    mailer.onModuleDestroy();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Demo seed failed.');
  process.exitCode = 1;
});
