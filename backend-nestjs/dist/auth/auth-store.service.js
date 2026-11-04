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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthStore = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const uuid_1 = require("../common/ids/uuid");
const USER_COLUMNS = 'SELECT `id`, `email`, `password_hash`, `status`, `email_verified_at`, `failed_login_count`, `locked_until`, `display_name`, `token_version`, `login_failure_window_started_at` FROM `users`';
let AuthStore = class AuthStore {
    source;
    constructor(source) {
        this.source = source;
    }
    get database() {
        if (!this.source)
            throw new common_1.ServiceUnavailableException('Authentication service is unavailable.');
        return this.source;
    }
    async findUserByEmail(email) {
        const rows = await this.database.query(`${USER_COLUMNS} WHERE \`email\` = ? LIMIT 1`, [email]);
        return rows[0] ? mapUser(rows[0]) : undefined;
    }
    async findUserById(id, db = this.database, lock = false) {
        const rows = await db.query(`${USER_COLUMNS} WHERE \`id\` = ?${lock ? ' FOR UPDATE' : ''}`, [(0, uuid_1.uuidToBinary)(id)]);
        return rows[0] ? mapUser(rows[0]) : undefined;
    }
    async findSession(id, db = this.database, lock = false) {
        const rows = await db.query(`SELECT \`id\`, \`user_id\`, \`active_tenant_id\`, \`expires_at\`, \`revoked_at\`, \`token_version\`
      FROM \`user_sessions\` WHERE \`id\` = ?${lock ? ' FOR UPDATE' : ''}`, [(0, uuid_1.uuidToBinary)(id)]);
        const row = rows[0];
        return row ? {
            id: (0, uuid_1.binaryToUuid)(row.id), userId: (0, uuid_1.binaryToUuid)(row.user_id),
            activeTenantId: row.active_tenant_id ? (0, uuid_1.binaryToUuid)(row.active_tenant_id) : null,
            expiresAt: row.expires_at, revokedAt: row.revoked_at, tokenVersion: Number(row.token_version),
        } : undefined;
    }
    async findTenant(id, db = this.database) {
        const rows = await db.query('SELECT `id`, `status` FROM `tenants` WHERE `id` = ? AND `deleted_at` IS NULL', [(0, uuid_1.uuidToBinary)(id)]);
        return rows[0] ? { id: (0, uuid_1.binaryToUuid)(rows[0].id), status: rows[0].status } : undefined;
    }
    async findMembership(userId, tenantId, db = this.database) {
        const rows = await db.query(`SELECT tu.\`status\`, tu.\`role_id\`, r.\`key\` AS role_key, r.\`is_platform\`
      FROM \`tenant_users\` tu JOIN \`roles\` r ON r.\`id\` = tu.\`role_id\`
      WHERE tu.\`user_id\` = ? AND tu.\`tenant_id\` = ?`, [(0, uuid_1.uuidToBinary)(userId), (0, uuid_1.uuidToBinary)(tenantId)]);
        const row = rows[0];
        return row ? { status: row.status, roleId: Number(row.role_id), roleKey: row.role_key, roleIsPlatform: Number(row.is_platform) === 1 } : undefined;
    }
    async listActiveMemberships(userId, db = this.database) {
        const rows = await db.query(`SELECT t.\`id\`, t.\`name\`, t.\`slug\`, t.\`status\`, r.\`key\` AS role_key
      FROM \`tenant_users\` tu JOIN \`tenants\` t ON t.\`id\` = tu.\`tenant_id\`
      JOIN \`roles\` r ON r.\`id\` = tu.\`role_id\`
      WHERE tu.\`user_id\` = ? AND tu.\`status\` = 'active' AND t.\`deleted_at\` IS NULL
      ORDER BY t.\`name\`, t.\`id\``, [(0, uuid_1.uuidToBinary)(userId)]);
        return rows.map((row) => ({ id: (0, uuid_1.binaryToUuid)(row.id), name: row.name, slug: row.slug, tenantStatus: row.status, role: row.role_key }));
    }
    async rolePermissions(roleId, db = this.database) {
        const rows = await db.query(`SELECT p.\`key\` FROM \`role_permissions\` rp
      JOIN \`permissions\` p ON p.\`id\` = rp.\`permission_id\`
      WHERE rp.\`role_id\` = ? ORDER BY p.\`key\``, [roleId]);
        return rows.map((row) => row.key);
    }
    async touchSession(userId, sessionId) {
        const now = new Date();
        await this.database.query(`UPDATE \`user_sessions\` SET \`last_seen_at\` = ?
      WHERE \`id\` = ? AND \`user_id\` = ? AND \`revoked_at\` IS NULL AND \`expires_at\` > ?
        AND (\`last_seen_at\` IS NULL OR \`last_seen_at\` < ?)`, [now, (0, uuid_1.uuidToBinary)(sessionId), (0, uuid_1.uuidToBinary)(userId), now, new Date(now.valueOf() - 60_000)]);
    }
    async platformRole(userId) {
        const rows = await this.database.query(`SELECT r.\`id\` FROM \`tenant_users\` tu
      JOIN \`roles\` r ON r.\`id\` = tu.\`role_id\` JOIN \`tenants\` t ON t.\`id\` = tu.\`tenant_id\`
      WHERE tu.\`user_id\` = ? AND tu.\`status\` = 'active'
      AND r.\`is_platform\` = 1 AND r.\`key\` = 'platform:admin'
      AND t.\`status\` = 'active' AND t.\`deleted_at\` IS NULL LIMIT 1`, [(0, uuid_1.uuidToBinary)(userId)]);
        return rows[0] ? Number(rows[0].id) : undefined;
    }
};
exports.AuthStore = AuthStore;
exports.AuthStore = AuthStore = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], AuthStore);
function mapUser(row) {
    return {
        id: (0, uuid_1.binaryToUuid)(row.id), email: row.email, passwordHash: row.password_hash, status: row.status,
        emailVerifiedAt: row.email_verified_at, failedLoginCount: Number(row.failed_login_count),
        lockedUntil: row.locked_until, displayName: row.display_name, tokenVersion: Number(row.token_version),
        loginFailureWindowStartedAt: row.login_failure_window_started_at,
    };
}
//# sourceMappingURL=auth-store.service.js.map