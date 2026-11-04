"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
exports.live = live;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
const auth_store_service_1 = require("./auth-store.service");
const auth_mailer_1 = require("./auth.mailer");
const password_service_1 = require("./password.service");
const token_service_1 = require("./token.service");
const auth_dto_1 = require("./auth.dto");
const AUTH_REQUIRED = 'Authentication required.';
const INVALID_CREDENTIALS = 'Invalid email or password.';
const FAILURE_WINDOW_MS = 15 * 60_000;
const RESET_TTL_MS = 60 * 60_000;
const VERIFY_TTL_MS = 24 * 60 * 60_000;
let AuthService = class AuthService {
    store;
    passwords;
    tokens;
    mailer;
    constructor(store, passwords, tokens, mailer) {
        this.store = store;
        this.passwords = passwords;
        this.tokens = tokens;
        this.mailer = mailer;
    }
    async register(input, exposeDevToken = false) {
        const dto = (0, auth_dto_1.parseRegisterInput)(input);
        this.mailer.ensureAvailable();
        const passwordHash = await this.passwords.hash(dto.password);
        const userId = (0, uuid_1.newUuidv7)();
        const verification = (0, token_service_1.newPendingToken)();
        let result;
        try {
            result = await this.store.database.transaction(async (db) => {
                let tenantId;
                let roleId;
                if (dto.inviteToken) {
                    const pending = await this.pending(db, 'invite', dto.inviteToken, true);
                    const payload = invitePayload(pending?.payload);
                    if (!pending || pending.user_id !== null || !unused(pending) || !payload || payload.email !== dto.email)
                        throw unauthorized();
                    tenantId = payload.tenantId;
                    if ((await this.store.findTenant(tenantId, db))?.status !== 'active')
                        throw unauthorized();
                    const roles = await db.query('SELECT `id` FROM `roles` WHERE `key` = ? AND `is_platform` = 0', [payload.roleKey]);
                    if (!roles[0])
                        throw unauthorized();
                    roleId = Number(roles[0].id);
                    await db.query('UPDATE `auth_pending_tokens` SET `used_at` = ? WHERE `id` = ?', [new Date(), pending.id]);
                }
                else {
                    const roles = await db.query("SELECT `id` FROM `roles` WHERE `key` = 'tenant:owner' AND `is_platform` = 0");
                    if (!roles[0])
                        throw new common_1.ServiceUnavailableException('Authentication service is unavailable.');
                    roleId = Number(roles[0].id);
                    tenantId = (0, uuid_1.newUuidv7)();
                    await db.query("INSERT INTO `tenants` (`id`, `name`, `slug`, `status`) VALUES (?, ?, ?, 'active')", [(0, uuid_1.uuidToBinary)(tenantId), dto.tenantName, dto.tenantSlug]);
                    await db.query('INSERT INTO `tenant_settings` (`tenant_id`) VALUES (?)', [(0, uuid_1.uuidToBinary)(tenantId)]);
                }
                await db.query("INSERT INTO `users` (`id`, `email`, `password_hash`, `display_name`, `status`) VALUES (?, ?, ?, ?, 'active')", [(0, uuid_1.uuidToBinary)(userId), dto.email, passwordHash, dto.name ?? null]);
                await db.query("INSERT INTO `tenant_users` (`id`, `tenant_id`, `user_id`, `role_id`, `status`, `joined_at`) VALUES (?, ?, ?, ?, 'active', ?)", [(0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()), (0, uuid_1.uuidToBinary)(tenantId), (0, uuid_1.uuidToBinary)(userId), roleId, new Date()]);
                await this.insertPending(db, 'email_verify', userId, verification, VERIFY_TTL_MS);
                const grant = await this.openSession(db, userId, null, 1);
                return { ...grant, user: { id: userId, email: dto.email, displayName: dto.name ?? null, emailVerified: false }, activeTenantId: null, tenants: await this.store.listActiveMemberships(userId, db) };
            });
        }
        catch (error) {
            const driver = error;
            if (driver.code === 'ER_DUP_ENTRY' || driver.errno === 1062)
                throw new common_1.ConflictException('This email or workspace identifier is already registered.');
            throw error;
        }
        await this.mailer.verification(dto.email, verification);
        return { ...result, ...(exposeDevToken && process.env.NODE_ENV !== 'production' ? { verificationToken: verification } : {}) };
    }
    async login(dto) {
        const candidate = await this.store.findUserByEmail(dto.email);
        if (!candidate) {
            await this.passwords.dummyVerify();
            throw new common_1.UnauthorizedException(INVALID_CREDENTIALS);
        }
        const valid = await this.passwords.verify(candidate.passwordHash, dto.password);
        const outcome = await this.store.database.transaction(async (db) => {
            const user = await this.store.findUserById(candidate.id, db, true);
            if (!user || user.status !== 'active' || user.passwordHash !== candidate.passwordHash || (user.lockedUntil && user.lockedUntil.valueOf() > Date.now()))
                return null;
            if (!valid) {
                const at = Date.now();
                const continuing = user.loginFailureWindowStartedAt !== null && at - user.loginFailureWindowStartedAt.valueOf() < FAILURE_WINDOW_MS;
                const count = continuing ? Math.min(user.failedLoginCount + 1, 65535) : 1;
                const lockMinutes = count >= 5 ? Math.min(2 ** Math.min(count - 5, 6), 60) : 0;
                await db.query('UPDATE `users` SET `failed_login_count` = ?, `login_failure_window_started_at` = ?, `locked_until` = ? WHERE `id` = ?', [count, continuing ? user.loginFailureWindowStartedAt : new Date(at), lockMinutes ? new Date(at + lockMinutes * 60_000) : null, (0, uuid_1.uuidToBinary)(user.id)]);
                return null;
            }
            const tenants = await this.store.listActiveMemberships(user.id, db);
            const activeTenantId = tenants.length === 1 && tenants[0].tenantStatus === 'active' ? tenants[0].id : null;
            await db.query('UPDATE `users` SET `failed_login_count` = 0, `login_failure_window_started_at` = NULL, `locked_until` = NULL, `last_login_at` = ? WHERE `id` = ?', [new Date(), (0, uuid_1.uuidToBinary)(user.id)]);
            return { ...await this.openSession(db, user.id, activeTenantId, user.tokenVersion), user: userDto(user), activeTenantId, tenants };
        });
        if (!outcome)
            throw new common_1.UnauthorizedException(INVALID_CREDENTIALS);
        return outcome;
    }
    async openSession(db, userId, tenantId, version) {
        const sessionId = (0, uuid_1.newUuidv7)();
        const refreshToken = (0, token_service_1.newRefreshToken)();
        const expiresAt = new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000);
        await db.query('INSERT INTO `user_sessions` (`id`, `user_id`, `active_tenant_id`, `token_version`, `expires_at`, `last_seen_at`) VALUES (?, ?, ?, ?, ?, ?)', [(0, uuid_1.uuidToBinary)(sessionId), (0, uuid_1.uuidToBinary)(userId), tenantId ? (0, uuid_1.uuidToBinary)(tenantId) : null, version, expiresAt, new Date()]);
        await db.query('INSERT INTO `refresh_tokens` (`id`, `user_id`, `session_id`, `family_id`, `token_hash`, `expires_at`) VALUES (?, ?, ?, ?, ?, ?)', [(0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()), (0, uuid_1.uuidToBinary)(userId), (0, uuid_1.uuidToBinary)(sessionId), (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()), (0, token_service_1.hashOpaqueToken)(refreshToken), expiresAt]);
        return { accessToken: this.tokens.sign({ userId, sessionId, tenantId }), refreshToken, expiresIn: this.tokens.accessTtlSeconds };
    }
    async refresh(presented) {
        if (!(0, token_service_1.isOpaqueToken)(presented, 'mzr_'))
            throw unauthorized();
        const hash = (0, token_service_1.hashOpaqueToken)(presented);
        const outcome = await this.store.database.transaction(async (db) => {
            const pointers = await db.query('SELECT `id`, `user_id`, `session_id` FROM `refresh_tokens` WHERE `token_hash` = ?', [hash]);
            const pointer = pointers[0];
            if (!pointer)
                return { kind: 'invalid' };
            const userId = (0, uuid_1.binaryToUuid)(pointer.user_id);
            const sessionId = (0, uuid_1.binaryToUuid)(pointer.session_id);
            const user = await this.store.findUserById(userId, db, true);
            const session = await this.store.findSession(sessionId, db, true);
            const rows = await db.query('SELECT `id`, `user_id`, `session_id`, `family_id`, `used_at`, `revoked_at`, `expires_at` FROM `refresh_tokens` WHERE `id` = ? AND `token_hash` = ? FOR UPDATE', [pointer.id, hash]);
            const row = rows[0];
            if (!row)
                return { kind: 'invalid' };
            if (row.used_at !== null) {
                await db.query('UPDATE `refresh_tokens` SET `revoked_at` = COALESCE(`revoked_at`, ?) WHERE `family_id` = ?', [new Date(), row.family_id]);
                await db.query("UPDATE `user_sessions` SET `revoked_at` = ?, `revoked_reason` = 'reuse_detected' WHERE `id` = ? AND `user_id` = ? AND `revoked_at` IS NULL", [new Date(), row.session_id, row.user_id]);
                return { kind: 'invalid' };
            }
            if (!session || !live(user, session) || row.revoked_at !== null || row.expires_at.valueOf() <= Date.now())
                return { kind: 'invalid' };
            if (session.activeTenantId) {
                const membership = await this.store.findMembership(user.id, session.activeTenantId, db);
                if (membership?.status !== 'active')
                    return { kind: 'invalid' };
                if ((await this.store.findTenant(session.activeTenantId, db))?.status !== 'active')
                    return { kind: 'tenant_unavailable' };
            }
            const nextRaw = (0, token_service_1.newRefreshToken)();
            const nextId = (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)());
            const expiresAt = new Date(Math.min(session.expiresAt.valueOf(), Date.now() + this.tokens.refreshTtlSeconds * 1000));
            await db.query('INSERT INTO `refresh_tokens` (`id`, `user_id`, `session_id`, `family_id`, `token_hash`, `expires_at`) VALUES (?, ?, ?, ?, ?, ?)', [nextId, row.user_id, row.session_id, row.family_id, (0, token_service_1.hashOpaqueToken)(nextRaw), expiresAt]);
            const updated = await db.query('UPDATE `refresh_tokens` SET `used_at` = ?, `replaced_by` = ? WHERE `id` = ? AND `used_at` IS NULL AND `revoked_at` IS NULL AND `expires_at` > ?', [new Date(), nextId, row.id, new Date()]);
            if (updated.affectedRows !== 1)
                throw unauthorized();
            return { kind: 'rotated', grant: { accessToken: this.tokens.sign({ userId, sessionId, tenantId: session.activeTenantId }), refreshToken: nextRaw, expiresIn: this.tokens.accessTtlSeconds } };
        });
        if (outcome.kind === 'tenant_unavailable')
            throw new common_1.ForbiddenException('Tenant access is unavailable.');
        if (outcome.kind !== 'rotated')
            throw unauthorized();
        return outcome.grant;
    }
    async logout(userId, sessionId, dto) {
        await this.store.database.transaction(async (db) => {
            const user = await this.store.findUserById(userId, db, true);
            const session = await this.store.findSession(sessionId, db, true);
            if (!session || !live(user, session))
                throw unauthorized();
            if (dto.allSessions) {
                await db.query('UPDATE `users` SET `token_version` = `token_version` + 1 WHERE `id` = ?', [(0, uuid_1.uuidToBinary)(userId)]);
                await revokeUserSessions(db, userId, 'logout');
            }
            else {
                await db.query("UPDATE `user_sessions` SET `revoked_at` = ?, `revoked_reason` = 'logout' WHERE `id` = ? AND `user_id` = ?", [new Date(), (0, uuid_1.uuidToBinary)(sessionId), (0, uuid_1.uuidToBinary)(userId)]);
                await db.query('UPDATE `refresh_tokens` SET `revoked_at` = COALESCE(`revoked_at`, ?) WHERE `session_id` = ? AND `user_id` = ?', [new Date(), (0, uuid_1.uuidToBinary)(sessionId), (0, uuid_1.uuidToBinary)(userId)]);
            }
        });
    }
    async me(userId, sessionId) {
        const user = await this.store.findUserById(userId);
        const session = await this.store.findSession(sessionId);
        if (!session || !live(user, session))
            throw unauthorized();
        const tenants = await this.store.listActiveMemberships(userId);
        const membership = session.activeTenantId ? await this.store.findMembership(userId, session.activeTenantId) : undefined;
        const tenant = session.activeTenantId ? await this.store.findTenant(session.activeTenantId) : undefined;
        const activeTenantId = membership?.status === 'active' && tenant?.status === 'active' ? session.activeTenantId : null;
        return { user: userDto(user), activeTenantId, permissions: activeTenantId && membership ? await this.store.rolePermissions(membership.roleId) : [], tenants };
    }
    async activate(userId, sessionId, tenantId) {
        if (!(0, uuid_1.isUuidv7)(tenantId))
            throw new common_1.NotFoundException();
        return this.store.database.transaction(async (db) => {
            const user = await this.store.findUserById(userId, db, true);
            const session = await this.store.findSession(sessionId, db, true);
            if (!session || !live(user, session))
                throw unauthorized();
            const membership = await this.store.findMembership(userId, tenantId, db);
            if (membership?.status !== 'active')
                throw new common_1.NotFoundException();
            if ((await this.store.findTenant(tenantId, db))?.status !== 'active')
                throw new common_1.ForbiddenException('Tenant access is unavailable.');
            await db.query('UPDATE `user_sessions` SET `active_tenant_id` = ? WHERE `id` = ? AND `user_id` = ? AND `revoked_at` IS NULL', [(0, uuid_1.uuidToBinary)(tenantId), (0, uuid_1.uuidToBinary)(sessionId), (0, uuid_1.uuidToBinary)(userId)]);
            return { accessToken: this.tokens.sign({ userId, sessionId, tenantId }), expiresIn: this.tokens.accessTtlSeconds, permissions: await this.store.rolePermissions(membership.roleId, db) };
        });
    }
    async requestPasswordReset(email, exposeDevToken = false) {
        this.mailer.ensureAvailable();
        if (!email)
            return undefined;
        const candidate = await this.store.findUserByEmail(email);
        if (!candidate)
            return undefined;
        const token = (0, token_service_1.newPendingToken)();
        const issued = await this.store.database.transaction(async (db) => {
            const user = await this.store.findUserById(candidate.id, db, true);
            if (user?.status !== 'active')
                return false;
            await this.insertPending(db, 'password_reset', user.id, token, RESET_TTL_MS);
            return true;
        });
        if (!issued)
            return undefined;
        this.mailer.passwordReset(email, token);
        return exposeDevToken && process.env.NODE_ENV !== 'production' ? token : undefined;
    }
    async resetPassword(presented, newPassword) {
        (0, auth_dto_1.validatePassword)(newPassword);
        if (!(0, token_service_1.isOpaqueToken)(presented, 'mzp_'))
            throw unauthorized();
        const pointer = await this.pending(this.store.database, 'password_reset', presented);
        if (!pointer?.user_id || !unused(pointer))
            throw unauthorized();
        const passwordHash = await this.passwords.hash(newPassword);
        const userId = (0, uuid_1.binaryToUuid)(pointer.user_id);
        const email = await this.store.database.transaction(async (db) => {
            const user = await this.store.findUserById(userId, db, true);
            const token = await this.pending(db, 'password_reset', presented, true);
            if (user?.status !== 'active' || !token?.user_id || (0, uuid_1.binaryToUuid)(token.user_id) !== userId || !unused(token))
                throw unauthorized();
            await db.query('UPDATE `users` SET `password_hash` = ?, `token_version` = `token_version` + 1, `failed_login_count` = 0, `locked_until` = NULL, `login_failure_window_started_at` = NULL WHERE `id` = ?', [passwordHash, (0, uuid_1.uuidToBinary)(userId)]);
            await revokeUserSessions(db, userId, 'password_change');
            await db.query("UPDATE `auth_pending_tokens` SET `used_at` = COALESCE(`used_at`, ?) WHERE `user_id` = ? AND `type` = 'password_reset'", [new Date(), (0, uuid_1.uuidToBinary)(userId)]);
            return user.email;
        });
        this.mailer.passwordChanged(email);
    }
    async verifyEmail(presented) {
        if (!(0, token_service_1.isOpaqueToken)(presented, 'mzp_'))
            throw unauthorized();
        const pointer = await this.pending(this.store.database, 'email_verify', presented);
        if (!pointer?.user_id || !unused(pointer))
            throw unauthorized();
        const userId = (0, uuid_1.binaryToUuid)(pointer.user_id);
        await this.store.database.transaction(async (db) => {
            const user = await this.store.findUserById(userId, db, true);
            const token = await this.pending(db, 'email_verify', presented, true);
            if (user?.status !== 'active' || !token?.user_id || (0, uuid_1.binaryToUuid)(token.user_id) !== userId || !unused(token))
                throw unauthorized();
            await db.query('UPDATE `users` SET `email_verified_at` = COALESCE(`email_verified_at`, ?) WHERE `id` = ?', [new Date(), (0, uuid_1.uuidToBinary)(userId)]);
            await db.query('UPDATE `auth_pending_tokens` SET `used_at` = ? WHERE `id` = ? AND `used_at` IS NULL', [new Date(), token.id]);
        });
    }
    async pending(db, type, token, lock = false) {
        const rows = await db.query(`SELECT \`id\`, \`user_id\`, \`payload\`, \`expires_at\`, \`used_at\` FROM \`auth_pending_tokens\` WHERE \`token_hash\` = ? AND \`type\` = ?${lock ? ' FOR UPDATE' : ''}`, [(0, token_service_1.hashOpaqueToken)(token), type]);
        return rows[0];
    }
    async insertPending(db, type, userId, token, lifetime) {
        await db.query('INSERT INTO `auth_pending_tokens` (`id`, `user_id`, `type`, `token_hash`, `expires_at`) VALUES (?, ?, ?, ?, ?)', [(0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()), (0, uuid_1.uuidToBinary)(userId), type, (0, token_service_1.hashOpaqueToken)(token), new Date(Date.now() + lifetime)]);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [auth_store_service_1.AuthStore, password_service_1.PasswordService,
        token_service_1.TokenService, auth_mailer_1.AuthMailer])
], AuthService);
function live(user, session) {
    return Boolean(user && session && user.status === 'active' && session.userId === user.id && session.revokedAt === null && session.expiresAt.valueOf() > Date.now() && session.tokenVersion === user.tokenVersion);
}
function unauthorized() { return new common_1.UnauthorizedException(AUTH_REQUIRED); }
function unused(row) { return row.used_at === null && row.expires_at.valueOf() > Date.now(); }
function userDto(user) { return { id: user.id, email: user.email, displayName: user.displayName, emailVerified: user.emailVerifiedAt !== null }; }
async function revokeUserSessions(db, userId, reason) {
    await db.query('UPDATE `user_sessions` SET `revoked_at` = ?, `revoked_reason` = ? WHERE `user_id` = ? AND `revoked_at` IS NULL', [new Date(), reason, (0, uuid_1.uuidToBinary)(userId)]);
    await db.query('UPDATE `refresh_tokens` SET `revoked_at` = COALESCE(`revoked_at`, ?) WHERE `user_id` = ?', [new Date(), (0, uuid_1.uuidToBinary)(userId)]);
}
function invitePayload(raw) {
    try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!value || typeof value !== 'object' || Array.isArray(value) || !(0, uuid_1.isUuidv7)(value.tenantId) ||
            typeof value.email !== 'string' || !['tenant:owner', 'tenant:admin', 'tenant:editor', 'tenant:member', 'tenant:viewer'].includes(value.roleKey))
            return undefined;
        return value;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=auth.service.js.map