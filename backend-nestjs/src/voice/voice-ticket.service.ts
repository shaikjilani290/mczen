import { ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth-context';
import type { TenantContext } from '../common/tenant/tenant-context.store';
import { SHARED_STATE, SharedStateUnavailableError, type SharedState } from '../shared-state/shared-state';
import type { VoiceIdentity } from './voice-auth.service';

const TICKET_TTL_MS = 30_000;

interface TicketRecord {
  identity: VoiceIdentity;
  origin: string;
}

/**
 * Tickets live in the shared store so any backend instance can redeem a ticket issued by another.
 * `take` is atomic, so a ticket is single-use across instances. If the store is down, issue and
 * consume fail closed; there is no process-local fallback.
 */
@Injectable()
export class VoiceTicketService {
  constructor(@Inject(SHARED_STATE) private readonly store: SharedState) {}

  async issue(user: AuthenticatedUser, tenant: TenantContext, origin: string | undefined) {
    const normalizedOrigin = validateOrigin(origin);
    if (tenant.actorType !== 'user' || tenant.userId !== user.userId ||
        tenant.tenantId !== user.activeTenantId ||
        !tenant.permissions.includes('conversations:write')) {
      throw new ForbiddenException('Voice access is unavailable.');
    }
    return this.store_({
      identity: {
        userId: user.userId,
        sessionId: user.sessionId,
        tenantId: tenant.tenantId,
        permissions: [...tenant.permissions],
      },
      origin: normalizedOrigin,
    });
  }

  /** Issues a ticket for an anonymous widget visitor. The caller has already validated the widget session and origin allowlist. */
  async issueIdentity(identity: VoiceIdentity, origin: string | undefined) {
    return this.store_({ identity: { ...identity, permissions: [...identity.permissions] }, origin: validateOrigin(origin) });
  }

  async consume(ticket: unknown, origin: string | undefined): Promise<VoiceIdentity> {
    if (typeof ticket !== 'string' || !/^mzt_[A-Za-z0-9_-]{43}$/.test(ticket)) {
      throw new UnauthorizedException('Voice authentication failed.');
    }
    let raw: string | null;
    try {
      raw = await this.store.take(this.key(ticket));
    } catch (error) {
      throw unavailable(error);
    }
    if (!raw) throw new UnauthorizedException('Voice authentication failed.');
    const record = JSON.parse(raw) as TicketRecord;
    // The ticket is already burned: a wrong origin cannot be retried.
    if (record.origin !== validateOrigin(origin)) throw new UnauthorizedException('Voice authentication failed.');
    return Object.freeze({ ...record.identity, permissions: Object.freeze([...record.identity.permissions]) });
  }

  private async store_(record: TicketRecord) {
    const ticket = `mzt_${randomBytes(32).toString('base64url')}`;
    try {
      await this.store.put(this.key(ticket), JSON.stringify(record), TICKET_TTL_MS);
    } catch (error) {
      throw unavailable(error);
    }
    return { ticket, expiresInMs: TICKET_TTL_MS };
  }

  private key(ticket: string): string {
    return `vt:${createHash('sha256').update(ticket).digest('hex')}`;
  }
}

function unavailable(error: unknown): Error {
  return error instanceof SharedStateUnavailableError
    ? new ServiceUnavailableException('Voice service is temporarily unavailable.')
    : (error as Error);
}

function validateOrigin(origin: string | undefined): string {
  if (!origin) throw new ForbiddenException('A browser origin is required for voice access.');
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password ||
        !['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    return parsed.origin;
  } catch {
    throw new ForbiddenException('Voice access is unavailable for this origin.');
  }
}
