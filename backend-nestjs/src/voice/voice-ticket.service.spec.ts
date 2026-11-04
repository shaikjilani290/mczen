import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth-context';
import type { TenantContext } from '../common/tenant/tenant-context.store';
import { MemorySharedState } from '../shared-state/memory-shared-state';
import { SharedStateUnavailableError, type SharedState } from '../shared-state/shared-state';
import { VoiceTicketService } from './voice-ticket.service';

describe('VoiceTicketService', () => {
  let store: MemorySharedState;
  let clock: number;
  let service: VoiceTicketService;
  const user: AuthenticatedUser = {
    userId: 'user-id',
    sessionId: 'session-id',
    activeTenantId: 'tenant-id',
  };
  const tenant: TenantContext = {
    tenantId: 'tenant-id',
    actorType: 'user',
    userId: 'user-id',
    permissions: ['conversations:write'],
  };
  const ORIGIN = 'https://mczen.example';

  beforeEach(() => {
    clock = 1_000_000;
    store = new MemorySharedState(() => clock);
    service = new VoiceTicketService(store);
  });

  it('issues an origin-bound ticket that can only be consumed once', async () => {
    const issued = await service.issue(user, tenant, ORIGIN);
    expect(issued.ticket).toMatch(/^mzt_[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresInMs).toBe(30_000);

    await expect(service.consume(issued.ticket, ORIGIN)).resolves.toEqual({
      userId: user.userId,
      sessionId: user.sessionId,
      tenantId: tenant.tenantId,
      permissions: ['conversations:write'],
    });
    await expect(service.consume(issued.ticket, ORIGIN)).rejects.toThrow(UnauthorizedException);
  });

  it('burns the ticket when presented from a different origin', async () => {
    const issued = await service.issue(user, tenant, ORIGIN);
    await expect(service.consume(issued.ticket, 'https://evil.example')).rejects.toThrow(UnauthorizedException);
    await expect(service.consume(issued.ticket, ORIGIN)).rejects.toThrow(UnauthorizedException);
  });

  it('allows only one of two concurrent redemptions', async () => {
    const issued = await service.issue(user, tenant, ORIGIN);
    const results = await Promise.allSettled([
      service.consume(issued.ticket, ORIGIN),
      service.consume(issued.ticket, ORIGIN),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('shares tickets between service instances using the same store', async () => {
    const other = new VoiceTicketService(store);
    const issued = await service.issue(user, tenant, ORIGIN);
    await expect(other.consume(issued.ticket, ORIGIN)).resolves.toMatchObject({ tenantId: 'tenant-id' });
    await expect(service.consume(issued.ticket, ORIGIN)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired ticket', async () => {
    const issued = await service.issue(user, tenant, ORIGIN);
    clock += 30_001;
    await expect(service.consume(issued.ticket, ORIGIN)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects malformed tickets', async () => {
    await expect(service.consume('mzt_short', ORIGIN)).rejects.toThrow(UnauthorizedException);
    await expect(service.consume(undefined, ORIGIN)).rejects.toThrow(UnauthorizedException);
  });

  it('fails closed when the user, tenant, permission, or origin is invalid', async () => {
    await expect(service.issue(user, { ...tenant, tenantId: 'other-tenant' }, ORIGIN)).rejects.toThrow(ForbiddenException);
    await expect(service.issue(user, { ...tenant, permissions: [] }, ORIGIN)).rejects.toThrow(ForbiddenException);
    await expect(service.issue(user, tenant, undefined)).rejects.toThrow(ForbiddenException);
  });

  it('issues widget identities without a user and keeps them tenant bound', async () => {
    const issued = await service.issueIdentity({
      userId: '', sessionId: 'w-1', tenantId: 'tenant-id', permissions: ['conversations:write'],
      widget: { assistantId: 'assistant-1', conversationId: 'conv-1', widgetSessionId: 'w-1' },
    }, ORIGIN);
    const identity = await service.consume(issued.ticket, ORIGIN);
    expect(identity.widget).toEqual({ assistantId: 'assistant-1', conversationId: 'conv-1', widgetSessionId: 'w-1' });
    expect(identity.tenantId).toBe('tenant-id');
  });

  it('fails closed (503) when shared state is unavailable, without local fallback', async () => {
    const broken = {
      put: jest.fn().mockRejectedValue(new SharedStateUnavailableError()),
      take: jest.fn().mockRejectedValue(new SharedStateUnavailableError()),
    } as unknown as SharedState;
    const failing = new VoiceTicketService(broken);
    await expect(failing.issue(user, tenant, ORIGIN)).rejects.toThrow(ServiceUnavailableException);
    await expect(failing.consume(`mzt_${'A'.repeat(43)}`, ORIGIN)).rejects.toThrow(ServiceUnavailableException);
  });
});
