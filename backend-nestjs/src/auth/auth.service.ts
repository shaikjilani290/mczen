import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { binaryToUuid, isUuidv7, newUuidv7, uuidToBinary } from '../common/ids/uuid';
import { AuthStore, type AuthDb, type MemberTenantDto, type SessionRow, type UserRow } from './auth-store.service';
import { AuthMailer } from './auth.mailer';
import { PasswordService } from './password.service';
import { TokenService, hashOpaqueToken, isOpaqueToken, newPendingToken, newRefreshToken } from './token.service';
import { parseRegisterInput, validatePassword, type LoginInput, type LogoutInput, type RegisterInput } from './auth.dto';

const AUTH_REQUIRED = 'Authentication required.';
const INVALID_CREDENTIALS = 'Invalid email or password.';
const FAILURE_WINDOW_MS = 15 * 60_000;
const RESET_TTL_MS = 60 * 60_000;
const VERIFY_TTL_MS = 24 * 60 * 60_000;

export interface GrantedTokens { accessToken: string; refreshToken: string; expiresIn: number }
export interface UserDto { id: string; email: string; displayName: string | null; emailVerified: boolean }
export interface MeResponse { user: UserDto; activeTenantId: string | null; permissions: string[]; tenants: MemberTenantDto[] }
export interface AuthResult extends GrantedTokens { user: UserDto; activeTenantId: string | null; tenants: MemberTenantDto[] }
export interface RegisterResult extends AuthResult { verificationToken?: string }

interface PendingRow { id: Buffer; user_id: Buffer | null; payload: unknown; expires_at: Date; used_at: Date | null }
interface RefreshRow { id: Buffer; user_id: Buffer; session_id: Buffer; family_id: Buffer; expires_at: Date; used_at: Date | null; revoked_at: Date | null }

/**
 * §8 flows. All state-changing auth transactions lock user → session → tokens
 * consistently; hashing runs outside locks. Failed-login and reuse outcomes are
 * thrown AFTER commit, not inside the transaction that must retain the evidence.
 */
@Injectable()
export class AuthService {
  constructor(private readonly store: AuthStore, private readonly passwords: PasswordService,
    private readonly tokens: TokenService, private readonly mailer: AuthMailer) {}

  async register(input: RegisterInput, exposeDevToken = false): Promise<RegisterResult> {
    const dto = parseRegisterInput(input);
    this.mailer.ensureAvailable();
    const passwordHash = await this.passwords.hash(dto.password);
    const userId = newUuidv7();
    const verification = newPendingToken();
    let result: AuthResult;
    try {
      result = await this.store.database.transaction(async (db) => {
        let tenantId: string;
        let roleId: number;
        if (dto.inviteToken) {
          const pending = await this.pending(db, 'invite', dto.inviteToken, true);
          const payload = invitePayload(pending?.payload);
          if (!pending || pending.user_id !== null || !unused(pending) || !payload || payload.email !== dto.email) throw unauthorized();
          tenantId = payload.tenantId;
          if ((await this.store.findTenant(tenantId, db))?.status !== 'active') throw unauthorized();
          const roles = await db.query('SELECT `id` FROM `roles` WHERE `key` = ? AND `is_platform` = 0', [payload.roleKey]) as Array<{ id: number }>;
          if (!roles[0]) throw unauthorized();
          roleId = Number(roles[0].id);
          await db.query('UPDATE `auth_pending_tokens` SET `used_at` = ? WHERE `id` = ?', [new Date(), pending.id]);
        } else {
          const roles = await db.query("SELECT `id` FROM `roles` WHERE `key` = 'tenant:owner' AND `is_platform` = 0") as Array<{ id: number }>;
          if (!roles[0]) throw new ServiceUnavailableException('Authentication service is unavailable.');
          roleId = Number(roles[0].id);
          tenantId = newUuidv7();
          await db.query("INSERT INTO `tenants` (`id`, `name`, `slug`, `status`) VALUES (?, ?, ?, 'active')", [uuidToBinary(tenantId), dto.tenantName, dto.tenantSlug]);
          await db.query('INSERT INTO `tenant_settings` (`tenant_id`) VALUES (?)', [uuidToBinary(tenantId)]);
        }
        await db.query("INSERT INTO `users` (`id`, `email`, `password_hash`, `display_name`, `status`) VALUES (?, ?, ?, ?, 'active')", [uuidToBinary(userId), dto.email, passwordHash, dto.name ?? null]);
        await db.query("INSERT INTO `tenant_users` (`id`, `tenant_id`, `user_id`, `role_id`, `status`, `joined_at`) VALUES (?, ?, ?, ?, 'active', ?)", [uuidToBinary(newUuidv7()), uuidToBinary(tenantId), uuidToBinary(userId), roleId, new Date()]);
        await this.insertPending(db, 'email_verify', userId, verification, VERIFY_TTL_MS);
        // §8.3: registration starts identity-only; activation/login selects tenancy.
        const grant = await this.openSession(db, userId, null, 1);
        return { ...grant, user: { id: userId, email: dto.email, displayName: dto.name ?? null, emailVerified: false }, activeTenantId: null, tenants: await this.store.listActiveMemberships(userId, db) };
      });
    } catch (error) {
      const driver = error as { code?: string; errno?: number };
      if (driver.code === 'ER_DUP_ENTRY' || driver.errno === 1062) throw new ConflictException('This email or workspace identifier is already registered.');
      throw error;
    }
    await this.mailer.verification(dto.email, verification);
    return { ...result, ...(exposeDevToken && process.env.NODE_ENV !== 'production' ? { verificationToken: verification } : {}) };
  }

  async login(dto: LoginInput): Promise<AuthResult> {
    const candidate = await this.store.findUserByEmail(dto.email);
    if (!candidate) { await this.passwords.dummyVerify(); throw new UnauthorizedException(INVALID_CREDENTIALS); }
    // Disabled/locked accounts still burn the same verification cost.
    const valid = await this.passwords.verify(candidate.passwordHash, dto.password);
    const outcome = await this.store.database.transaction(async (db) => {
      const user = await this.store.findUserById(candidate.id, db, true);
      if (!user || user.status !== 'active' || user.passwordHash !== candidate.passwordHash || (user.lockedUntil && user.lockedUntil.valueOf() > Date.now())) return null;
      if (!valid) {
        const at = Date.now();
        const continuing = user.loginFailureWindowStartedAt !== null && at - user.loginFailureWindowStartedAt.valueOf() < FAILURE_WINDOW_MS;
        const count = continuing ? Math.min(user.failedLoginCount + 1, 65535) : 1;
        const lockMinutes = count >= 5 ? Math.min(2 ** Math.min(count - 5, 6), 60) : 0;
        await db.query('UPDATE `users` SET `failed_login_count` = ?, `login_failure_window_started_at` = ?, `locked_until` = ? WHERE `id` = ?',
          [count, continuing ? user.loginFailureWindowStartedAt : new Date(at), lockMinutes ? new Date(at + lockMinutes * 60_000) : null, uuidToBinary(user.id)]);
        return null;
      }
      const tenants = await this.store.listActiveMemberships(user.id, db);
      const activeTenantId = tenants.length === 1 && tenants[0].tenantStatus === 'active' ? tenants[0].id : null;
      await db.query('UPDATE `users` SET `failed_login_count` = 0, `login_failure_window_started_at` = NULL, `locked_until` = NULL, `last_login_at` = ? WHERE `id` = ?', [new Date(), uuidToBinary(user.id)]);
      return { ...await this.openSession(db, user.id, activeTenantId, user.tokenVersion), user: userDto(user), activeTenantId, tenants };
    });
    if (!outcome) throw new UnauthorizedException(INVALID_CREDENTIALS);
    return outcome;
  }

  private async openSession(db: AuthDb, userId: string, tenantId: string | null, version: number): Promise<GrantedTokens> {
    const sessionId = newUuidv7();
    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000);
    await db.query('INSERT INTO `user_sessions` (`id`, `user_id`, `active_tenant_id`, `token_version`, `expires_at`, `last_seen_at`) VALUES (?, ?, ?, ?, ?, ?)', [uuidToBinary(sessionId), uuidToBinary(userId), tenantId ? uuidToBinary(tenantId) : null, version, expiresAt, new Date()]);
    await db.query('INSERT INTO `refresh_tokens` (`id`, `user_id`, `session_id`, `family_id`, `token_hash`, `expires_at`) VALUES (?, ?, ?, ?, ?, ?)', [uuidToBinary(newUuidv7()), uuidToBinary(userId), uuidToBinary(sessionId), uuidToBinary(newUuidv7()), hashOpaqueToken(refreshToken), expiresAt]);
    return { accessToken: this.tokens.sign({ userId, sessionId, tenantId }), refreshToken, expiresIn: this.tokens.accessTtlSeconds };
  }

  async refresh(presented: unknown): Promise<GrantedTokens> {
    if (!isOpaqueToken(presented, 'mzr_')) throw unauthorized();
    const hash = hashOpaqueToken(presented);
    const outcome = await this.store.database.transaction(async (db) => {
      const pointers = await db.query('SELECT `id`, `user_id`, `session_id` FROM `refresh_tokens` WHERE `token_hash` = ?', [hash]) as RefreshRow[];
      const pointer = pointers[0];
      if (!pointer) return { kind: 'invalid' } as const;
      const userId = binaryToUuid(pointer.user_id);
      const sessionId = binaryToUuid(pointer.session_id);
      const user = await this.store.findUserById(userId, db, true);
      const session = await this.store.findSession(sessionId, db, true);
      const rows = await db.query('SELECT `id`, `user_id`, `session_id`, `family_id`, `used_at`, `revoked_at`, `expires_at` FROM `refresh_tokens` WHERE `id` = ? AND `token_hash` = ? FOR UPDATE', [pointer.id, hash]) as RefreshRow[];
      const row = rows[0];
      if (!row) return { kind: 'invalid' } as const;
      if (row.used_at !== null) {
        await db.query('UPDATE `refresh_tokens` SET `revoked_at` = COALESCE(`revoked_at`, ?) WHERE `family_id` = ?', [new Date(), row.family_id]);
        await db.query("UPDATE `user_sessions` SET `revoked_at` = ?, `revoked_reason` = 'reuse_detected' WHERE `id` = ? AND `user_id` = ? AND `revoked_at` IS NULL", [new Date(), row.session_id, row.user_id]);
        return { kind: 'invalid' } as const; // quarantine MUST commit before the 401
      }
      if (!session || !live(user, session) || row.revoked_at !== null || row.expires_at.valueOf() <= Date.now()) return { kind: 'invalid' } as const;
      if (session.activeTenantId) {
        const membership = await this.store.findMembership(user.id, session.activeTenantId, db);
        if (membership?.status !== 'active') return { kind: 'invalid' } as const;
        if ((await this.store.findTenant(session.activeTenantId, db))?.status !== 'active') return { kind: 'tenant_unavailable' } as const;
      }
      const nextRaw = newRefreshToken();
      const nextId = uuidToBinary(newUuidv7());
      // Absolute family/session horizon: rotating cannot extend a session beyond 30 days.
      const expiresAt = new Date(Math.min(session.expiresAt.valueOf(), Date.now() + this.tokens.refreshTtlSeconds * 1000));
      await db.query('INSERT INTO `refresh_tokens` (`id`, `user_id`, `session_id`, `family_id`, `token_hash`, `expires_at`) VALUES (?, ?, ?, ?, ?, ?)', [nextId, row.user_id, row.session_id, row.family_id, hashOpaqueToken(nextRaw), expiresAt]);
      const updated = await db.query('UPDATE `refresh_tokens` SET `used_at` = ?, `replaced_by` = ? WHERE `id` = ? AND `used_at` IS NULL AND `revoked_at` IS NULL AND `expires_at` > ?', [new Date(), nextId, row.id, new Date()]) as { affectedRows: number };
      if (updated.affectedRows !== 1) throw unauthorized(); // roll back an unexpected conditional-write miss
      return { kind: 'rotated', grant: { accessToken: this.tokens.sign({ userId, sessionId, tenantId: session.activeTenantId }), refreshToken: nextRaw, expiresIn: this.tokens.accessTtlSeconds } } as const;
    });
    if (outcome.kind === 'tenant_unavailable') throw new ForbiddenException('Tenant access is unavailable.');
    if (outcome.kind !== 'rotated') throw unauthorized();
    return outcome.grant;
  }

  async logout(userId: string, sessionId: string, dto: LogoutInput): Promise<void> {
    await this.store.database.transaction(async (db) => {
      const user = await this.store.findUserById(userId, db, true);
      const session = await this.store.findSession(sessionId, db, true);
      if (!session || !live(user, session)) throw unauthorized();
      if (dto.allSessions) {
        await db.query('UPDATE `users` SET `token_version` = `token_version` + 1 WHERE `id` = ?', [uuidToBinary(userId)]);
        await revokeUserSessions(db, userId, 'logout');
      } else {
        await db.query("UPDATE `user_sessions` SET `revoked_at` = ?, `revoked_reason` = 'logout' WHERE `id` = ? AND `user_id` = ?", [new Date(), uuidToBinary(sessionId), uuidToBinary(userId)]);
        await db.query('UPDATE `refresh_tokens` SET `revoked_at` = COALESCE(`revoked_at`, ?) WHERE `session_id` = ? AND `user_id` = ?', [new Date(), uuidToBinary(sessionId), uuidToBinary(userId)]);
      }
      // The optional refreshToken never selects another session or user.
    });
  }

  async me(userId: string, sessionId: string): Promise<MeResponse> {
    const user = await this.store.findUserById(userId);
    const session = await this.store.findSession(sessionId);
    if (!session || !live(user, session)) throw unauthorized();
    const tenants = await this.store.listActiveMemberships(userId);
    const membership = session.activeTenantId ? await this.store.findMembership(userId, session.activeTenantId) : undefined;
    const tenant = session.activeTenantId ? await this.store.findTenant(session.activeTenantId) : undefined;
    const activeTenantId = membership?.status === 'active' && tenant?.status === 'active' ? session.activeTenantId : null;
    return { user: userDto(user), activeTenantId, permissions: activeTenantId && membership ? await this.store.rolePermissions(membership.roleId) : [], tenants };
  }

  async activate(userId: string, sessionId: string, tenantId: string): Promise<{ accessToken: string; expiresIn: number; permissions: string[] }> {
    if (!isUuidv7(tenantId)) throw new NotFoundException();
    return this.store.database.transaction(async (db) => {
      const user = await this.store.findUserById(userId, db, true);
      const session = await this.store.findSession(sessionId, db, true);
      if (!session || !live(user, session)) throw unauthorized();
      const membership = await this.store.findMembership(userId, tenantId, db);
      if (membership?.status !== 'active') throw new NotFoundException();
      if ((await this.store.findTenant(tenantId, db))?.status !== 'active') throw new ForbiddenException('Tenant access is unavailable.');
      await db.query('UPDATE `user_sessions` SET `active_tenant_id` = ? WHERE `id` = ? AND `user_id` = ? AND `revoked_at` IS NULL', [uuidToBinary(tenantId), uuidToBinary(sessionId), uuidToBinary(userId)]);
      return { accessToken: this.tokens.sign({ userId, sessionId, tenantId }), expiresIn: this.tokens.accessTtlSeconds, permissions: await this.store.rolePermissions(membership.roleId, db) };
    });
  }

  async requestPasswordReset(email: string | undefined, exposeDevToken = false): Promise<string | undefined> {
    this.mailer.ensureAvailable();
    if (!email) return undefined;
    const candidate = await this.store.findUserByEmail(email);
    if (!candidate) return undefined;
    const token = newPendingToken();
    const issued = await this.store.database.transaction(async (db) => {
      const user = await this.store.findUserById(candidate.id, db, true);
      if (user?.status !== 'active') return false;
      await this.insertPending(db, 'password_reset', user.id, token, RESET_TTL_MS);
      return true;
    });
    if (!issued) return undefined;
    this.mailer.passwordReset(email, token);
    return exposeDevToken && process.env.NODE_ENV !== 'production' ? token : undefined;
  }

  async resetPassword(presented: unknown, newPassword: unknown): Promise<void> {
    validatePassword(newPassword);
    if (!isOpaqueToken(presented, 'mzp_')) throw unauthorized();
    const pointer = await this.pending(this.store.database, 'password_reset', presented);
    if (!pointer?.user_id || !unused(pointer)) throw unauthorized();
    const passwordHash = await this.passwords.hash(newPassword);
    const userId = binaryToUuid(pointer.user_id);
    const email = await this.store.database.transaction(async (db) => {
      const user = await this.store.findUserById(userId, db, true);
      const token = await this.pending(db, 'password_reset', presented, true);
      if (user?.status !== 'active' || !token?.user_id || binaryToUuid(token.user_id) !== userId || !unused(token)) throw unauthorized();
      await db.query('UPDATE `users` SET `password_hash` = ?, `token_version` = `token_version` + 1, `failed_login_count` = 0, `locked_until` = NULL, `login_failure_window_started_at` = NULL WHERE `id` = ?', [passwordHash, uuidToBinary(userId)]);
      await revokeUserSessions(db, userId, 'password_change');
      // Invalidate every outstanding reset link, atomically with the password change.
      await db.query("UPDATE `auth_pending_tokens` SET `used_at` = COALESCE(`used_at`, ?) WHERE `user_id` = ? AND `type` = 'password_reset'", [new Date(), uuidToBinary(userId)]);
      return user.email;
    });
    this.mailer.passwordChanged(email);
  }

  async verifyEmail(presented: unknown): Promise<void> {
    if (!isOpaqueToken(presented, 'mzp_')) throw unauthorized();
    const pointer = await this.pending(this.store.database, 'email_verify', presented);
    if (!pointer?.user_id || !unused(pointer)) throw unauthorized();
    const userId = binaryToUuid(pointer.user_id);
    await this.store.database.transaction(async (db) => {
      const user = await this.store.findUserById(userId, db, true);
      const token = await this.pending(db, 'email_verify', presented, true);
      if (user?.status !== 'active' || !token?.user_id || binaryToUuid(token.user_id) !== userId || !unused(token)) throw unauthorized();
      await db.query('UPDATE `users` SET `email_verified_at` = COALESCE(`email_verified_at`, ?) WHERE `id` = ?', [new Date(), uuidToBinary(userId)]);
      await db.query('UPDATE `auth_pending_tokens` SET `used_at` = ? WHERE `id` = ? AND `used_at` IS NULL', [new Date(), token.id]);
    });
  }

  private async pending(db: AuthDb, type: string, token: string, lock = false): Promise<PendingRow | undefined> {
    const rows = await db.query(`SELECT \`id\`, \`user_id\`, \`payload\`, \`expires_at\`, \`used_at\` FROM \`auth_pending_tokens\` WHERE \`token_hash\` = ? AND \`type\` = ?${lock ? ' FOR UPDATE' : ''}`, [hashOpaqueToken(token), type]) as PendingRow[];
    return rows[0];
  }

  private async insertPending(db: AuthDb, type: string, userId: string, token: string, lifetime: number): Promise<void> {
    await db.query('INSERT INTO `auth_pending_tokens` (`id`, `user_id`, `type`, `token_hash`, `expires_at`) VALUES (?, ?, ?, ?, ?)', [uuidToBinary(newUuidv7()), uuidToBinary(userId), type, hashOpaqueToken(token), new Date(Date.now() + lifetime)]);
  }
}

export function live(user: UserRow | undefined, session: SessionRow | undefined): user is UserRow {
  return Boolean(user && session && user.status === 'active' && session.userId === user.id && session.revokedAt === null && session.expiresAt.valueOf() > Date.now() && session.tokenVersion === user.tokenVersion);
}

function unauthorized(): UnauthorizedException { return new UnauthorizedException(AUTH_REQUIRED); }
function unused(row: PendingRow): boolean { return row.used_at === null && row.expires_at.valueOf() > Date.now(); }
function userDto(user: UserRow): UserDto { return { id: user.id, email: user.email, displayName: user.displayName, emailVerified: user.emailVerifiedAt !== null }; }

async function revokeUserSessions(db: AuthDb, userId: string, reason: string): Promise<void> {
  await db.query('UPDATE `user_sessions` SET `revoked_at` = ?, `revoked_reason` = ? WHERE `user_id` = ? AND `revoked_at` IS NULL', [new Date(), reason, uuidToBinary(userId)]);
  await db.query('UPDATE `refresh_tokens` SET `revoked_at` = COALESCE(`revoked_at`, ?) WHERE `user_id` = ?', [new Date(), uuidToBinary(userId)]);
}

/** Invite creation belongs to 6D; mailbox/tenant/role bindings must be server-issued. */
function invitePayload(raw: unknown): { tenantId: string; roleKey: string; email: string } | undefined {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value) || !isUuidv7(value.tenantId) ||
      typeof value.email !== 'string' || !['tenant:owner', 'tenant:admin', 'tenant:editor', 'tenant:member', 'tenant:viewer'].includes(value.roleKey)) return undefined;
    return value;
  } catch { return undefined; }
}
