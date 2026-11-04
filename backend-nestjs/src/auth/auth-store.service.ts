import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { binaryToUuid, uuidToBinary } from '../common/ids/uuid';

/** Parameterized SQL only, against the accepted 6B schema + additive 6C migrations. */
export type AuthDb = Pick<DataSource, 'query'>;

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  status: 'active' | 'disabled' | 'erased';
  emailVerifiedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  displayName: string | null;
  tokenVersion: number;
  loginFailureWindowStartedAt: Date | null;
}

export interface MemberTenantDto {
  id: string;
  name: string;
  slug: string;
  tenantStatus: 'active' | 'suspended' | 'closed';
  /** Global role key, as proposed by §8.6's `tenants[].role` contract. */
  role: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  activeTenantId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  tokenVersion: number;
}

export interface MembershipRow {
  status: string;
  roleId: number;
  roleKey: string;
  roleIsPlatform: boolean;
}

interface RawUser {
  id: Buffer;
  email: string;
  password_hash: string;
  status: UserRow['status'];
  email_verified_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  display_name: string | null;
  token_version: number;
  login_failure_window_started_at: Date | null;
}

const USER_COLUMNS = 'SELECT `id`, `email`, `password_hash`, `status`, `email_verified_at`, `failed_login_count`, `locked_until`, `display_name`, `token_version`, `login_failure_window_started_at` FROM `users`';

@Injectable()
export class AuthStore {
  // No-DB development still boots; any actual authentication DB access fails closed.
  constructor(@Optional() @InjectDataSource() private readonly source?: DataSource) {}

  get database(): DataSource {
    if (!this.source) throw new ServiceUnavailableException('Authentication service is unavailable.');
    return this.source;
  }

  async findUserByEmail(email: string): Promise<UserRow | undefined> {
    const rows = await this.database.query(`${USER_COLUMNS} WHERE \`email\` = ? LIMIT 1`, [email]) as RawUser[];
    return rows[0] ? mapUser(rows[0]) : undefined;
  }

  async findUserById(id: string, db: AuthDb = this.database, lock = false): Promise<UserRow | undefined> {
    const rows = await db.query(`${USER_COLUMNS} WHERE \`id\` = ?${lock ? ' FOR UPDATE' : ''}`, [uuidToBinary(id)]) as RawUser[];
    return rows[0] ? mapUser(rows[0]) : undefined;
  }

  async findSession(id: string, db: AuthDb = this.database, lock = false): Promise<SessionRow | undefined> {
    const rows = await db.query(`SELECT \`id\`, \`user_id\`, \`active_tenant_id\`, \`expires_at\`, \`revoked_at\`, \`token_version\`
      FROM \`user_sessions\` WHERE \`id\` = ?${lock ? ' FOR UPDATE' : ''}`, [uuidToBinary(id)]) as Array<{
      id: Buffer; user_id: Buffer; active_tenant_id: Buffer | null;
      expires_at: Date; revoked_at: Date | null; token_version: number;
    }>;
    const row = rows[0];
    return row ? {
      id: binaryToUuid(row.id), userId: binaryToUuid(row.user_id),
      activeTenantId: row.active_tenant_id ? binaryToUuid(row.active_tenant_id) : null,
      expiresAt: row.expires_at, revokedAt: row.revoked_at, tokenVersion: Number(row.token_version),
    } : undefined;
  }

  async findTenant(id: string, db: AuthDb = this.database): Promise<{ id: string; status: string } | undefined> {
    const rows = await db.query('SELECT `id`, `status` FROM `tenants` WHERE `id` = ? AND `deleted_at` IS NULL', [uuidToBinary(id)]) as Array<{ id: Buffer; status: string }>;
    return rows[0] ? { id: binaryToUuid(rows[0].id), status: rows[0].status } : undefined;
  }

  async findMembership(userId: string, tenantId: string, db: AuthDb = this.database): Promise<MembershipRow | undefined> {
    const rows = await db.query(`SELECT tu.\`status\`, tu.\`role_id\`, r.\`key\` AS role_key, r.\`is_platform\`
      FROM \`tenant_users\` tu JOIN \`roles\` r ON r.\`id\` = tu.\`role_id\`
      WHERE tu.\`user_id\` = ? AND tu.\`tenant_id\` = ?`, [uuidToBinary(userId), uuidToBinary(tenantId)]) as Array<{
      status: string; role_id: number; role_key: string; is_platform: number;
    }>;
    const row = rows[0];
    return row ? { status: row.status, roleId: Number(row.role_id), roleKey: row.role_key, roleIsPlatform: Number(row.is_platform) === 1 } : undefined;
  }

  async listActiveMemberships(userId: string, db: AuthDb = this.database): Promise<MemberTenantDto[]> {
    const rows = await db.query(`SELECT t.\`id\`, t.\`name\`, t.\`slug\`, t.\`status\`, r.\`key\` AS role_key
      FROM \`tenant_users\` tu JOIN \`tenants\` t ON t.\`id\` = tu.\`tenant_id\`
      JOIN \`roles\` r ON r.\`id\` = tu.\`role_id\`
      WHERE tu.\`user_id\` = ? AND tu.\`status\` = 'active' AND t.\`deleted_at\` IS NULL
      ORDER BY t.\`name\`, t.\`id\``, [uuidToBinary(userId)]) as Array<{
      id: Buffer; name: string; slug: string; status: MemberTenantDto['tenantStatus']; role_key: string;
    }>;
    return rows.map((row) => ({ id: binaryToUuid(row.id), name: row.name, slug: row.slug, tenantStatus: row.status, role: row.role_key }));
  }

  async rolePermissions(roleId: number, db: AuthDb = this.database): Promise<string[]> {
    const rows = await db.query(`SELECT p.\`key\` FROM \`role_permissions\` rp
      JOIN \`permissions\` p ON p.\`id\` = rp.\`permission_id\`
      WHERE rp.\`role_id\` = ? ORDER BY p.\`key\``, [roleId]) as Array<{ key: string }>;
    return rows.map((row) => row.key);
  }

  /** Activity metadata only, at most one write per minute; never extends expiry. */
  async touchSession(userId: string, sessionId: string): Promise<void> {
    const now = new Date();
    await this.database.query(`UPDATE \`user_sessions\` SET \`last_seen_at\` = ?
      WHERE \`id\` = ? AND \`user_id\` = ? AND \`revoked_at\` IS NULL AND \`expires_at\` > ?
        AND (\`last_seen_at\` IS NULL OR \`last_seen_at\` < ?)`,
    [now, uuidToBinary(sessionId), uuidToBinary(userId), now, new Date(now.valueOf() - 60_000)]);
  }

  /** No staff table exists in 6A: use only an explicit, active, DB-assigned reserved role. */
  async platformRole(userId: string): Promise<number | undefined> {
    const rows = await this.database.query(`SELECT r.\`id\` FROM \`tenant_users\` tu
      JOIN \`roles\` r ON r.\`id\` = tu.\`role_id\` JOIN \`tenants\` t ON t.\`id\` = tu.\`tenant_id\`
      WHERE tu.\`user_id\` = ? AND tu.\`status\` = 'active'
      AND r.\`is_platform\` = 1 AND r.\`key\` = 'platform:admin'
      AND t.\`status\` = 'active' AND t.\`deleted_at\` IS NULL LIMIT 1`, [uuidToBinary(userId)]) as Array<{ id: number }>;
    return rows[0] ? Number(rows[0].id) : undefined;
  }
}

function mapUser(row: RawUser): UserRow {
  return {
    id: binaryToUuid(row.id), email: row.email, passwordHash: row.password_hash, status: row.status,
    emailVerifiedAt: row.email_verified_at, failedLoginCount: Number(row.failed_login_count),
    lockedUntil: row.locked_until, displayName: row.display_name, tokenVersion: Number(row.token_version),
    loginFailureWindowStartedAt: row.login_failure_window_started_at,
  };
}
