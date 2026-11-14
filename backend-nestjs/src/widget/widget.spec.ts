import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { newUuidv7 } from '../common/ids/uuid';
import { tenantContextStore } from '../common/tenant/tenant-context.store';
import { parseDateRange, parsePublicMessage, parsePublicSession, parseTenantStatus, parseWidgetSettingsUpdate, normalizeOrigin } from './widget.dto';
import type { WidgetSettingsView } from './widget.repository';
import { WIDGET_PERMISSIONS, WidgetService } from './widget.service';
import { MemorySharedState } from '../shared-state/memory-shared-state';
import { SharedRateLimiter } from '../shared-state/rate-limiter';
import { SharedStateUnavailableError } from '../shared-state/shared-state';
import { WidgetSessionTokens } from './widget-session.tokens';

const KEY = `wk_${'a'.repeat(32)}`;
const tenantA = newUuidv7();
const tenantB = newUuidv7();
const assistant = newUuidv7();
const origin = 'https://shop.example.test';

function settings(over: Partial<WidgetSettingsView> = {}): WidgetSettingsView {
  return {
    publicKey: KEY, enabled: true, assistantId: null, name: 'Shop', logoUrl: null, primaryColor: '#112233', theme: 'auto',
    position: 'bottom-right', buttonStyle: 'round', welcomeMessage: 'Hi', initialGreeting: null, allowedOrigins: [origin],
    keyRotatedAt: null, updatedAt: new Date().toISOString(), ...over,
  };
}

function build(over: { settings?: Partial<WidgetSettingsView>; tenant?: string } = {}) {
  const repository = {
    findByPublicKey: jest.fn(async (key: string) => key === KEY ? { tenantId: tenantA, settings: settings(over.settings) } : undefined),
    findForTenant: jest.fn(async (tenant: string) => tenant === tenantA ? { tenantId: tenantA, settings: settings(over.settings) } : undefined),
    resolveAssistant: jest.fn(async () => ({ id: assistant, name: 'A', greeting: 'Hello', languages: ['en', 'hi', 'te'], defaultLanguage: 'en' })),
    createWidgetConversation: jest.fn(async () => newUuidv7()),
    getOrCreate: jest.fn(async () => settings()),
    update: jest.fn(async () => settings()),
    rotateKey: jest.fn(async () => settings()),
    analytics: jest.fn(async () => ({})),
  };
  const agent = { ask: jest.fn(async () => ({ success: true, answer: 'Hello!', model: 'm', toolCalls: [], sources: [] })) };
  const voice = {
    availability: jest.fn(async () => ({ available: true, speechLanguages: ['en', 'hi'], textOnlyLanguages: ['te'] })),
    issueTicket: jest.fn(async () => ({ ticket: 'mzt_' + 'T'.repeat(43), expiresInMs: 30000, availability: { available: true, speechLanguages: ['en'], textOnlyLanguages: ['te'] } })),
  };
  const store = new MemorySharedState();
  return { repository, agent, voice, store, service: new WidgetService(repository as never, agent as never, store, voice as never) };
}

describe('widget DTO validation', () => {
  it('accepts only exact origins', () => {
    expect(normalizeOrigin('https://Shop.Example.test', true)).toBe(origin);
    for (const bad of ['*', 'https://*.example.test', 'https://example.test/path', 'http://example.test', 'https://u:p@example.test', 'javascript:alert(1)', 'https://example.test?x=1'])
      expect(() => normalizeOrigin(bad, true)).toThrow(BadRequestException);
    expect(normalizeOrigin('http://localhost:5174', false)).toBe('http://localhost:5174');
    expect(() => normalizeOrigin('http://localhost:5174', true)).toThrow(BadRequestException);
  });
  it('rejects unknown, empty and unsafe settings', () => {
    expect(() => parseWidgetSettingsUpdate({})).toThrow(BadRequestException);
    expect(() => parseWidgetSettingsUpdate({ tenantId: tenantB })).toThrow(BadRequestException);
    expect(() => parseWidgetSettingsUpdate({ publicKey: KEY })).toThrow(BadRequestException);
    expect(() => parseWidgetSettingsUpdate({ primaryColor: 'red' })).toThrow(BadRequestException);
    expect(() => parseWidgetSettingsUpdate({ logoUrl: 'http://x.test/a.png' })).toThrow(BadRequestException);
    expect(() => parseWidgetSettingsUpdate({ theme: 'neon' })).toThrow(BadRequestException);
    expect(() => parseWidgetSettingsUpdate({ assistantId: 'nope' })).toThrow(BadRequestException);
    expect(parseWidgetSettingsUpdate({ primaryColor: '#ABCDEF', allowedOrigins: [origin, origin], enabled: true }))
      .toEqual({ primaryColor: '#abcdef', allowedOrigins: [origin], enabled: true });
  });
  it('validates public session and message bodies', () => {
    expect(() => parsePublicSession({ publicKey: 'x' })).toThrow(BadRequestException);
    expect(() => parsePublicSession({ publicKey: KEY, tenantId: tenantB })).toThrow(BadRequestException);
    expect(parsePublicSession({ publicKey: KEY, language: 'te' })).toEqual({ publicKey: KEY, language: 'te' });
    expect(() => parsePublicMessage({ message: '' })).toThrow(BadRequestException);
    expect(() => parsePublicMessage({ message: 'x'.repeat(2001) })).toThrow(BadRequestException);
    expect(() => parsePublicMessage({ message: 'hi', language: 'fr' })).toThrow(BadRequestException);
    expect(parsePublicMessage({ message: ' hi ' })).toEqual({ message: 'hi' });
  });
  it('bounds analytics date ranges', () => {
    const now = new Date('2025-03-10T12:00:00Z');
    expect(parseDateRange({}, now).to.toISOString()).toBe('2025-03-11T00:00:00.000Z');
    expect(() => parseDateRange({ from: '2025-03-10', to: '2025-03-01' }, now)).toThrow(BadRequestException);
    expect(() => parseDateRange({ from: '2020-01-01', to: '2025-03-01' }, now)).toThrow(BadRequestException);
    expect(() => parseDateRange({ from: '2025-02-30' }, now)).toThrow(BadRequestException);
  });
  it('validates platform tenant status changes', () => {
    expect(parseTenantStatus({ status: 'suspended', reason: 'abuse' })).toEqual({ status: 'suspended', reason: 'abuse' });
    expect(() => parseTenantStatus({ status: 'closed' })).toThrow(BadRequestException);
  });
});

describe('widget session tokens', () => {
  it('verifies, expires and rejects tampering', () => {
    let now = 1_000_000;
    const tokens = new WidgetSessionTokens('s'.repeat(32), () => now);
    const { token } = tokens.issue({ t: tenantA, a: assistant, o: origin });
    expect(tokens.verify(token)?.t).toBe(tenantA);
    const [head, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ t: tenantB, a: assistant, o: origin, e: now + 60_000, m: now + 60_000 })).toString('base64url');
    expect(tokens.verify(`mzw_${forged}.${signature}`)).toBeUndefined();
    expect(tokens.verify(`${head}.x`)).toBeUndefined();
    expect(new WidgetSessionTokens('z'.repeat(32), () => now).verify(token)).toBeUndefined();
    now += 31 * 60_000;
    expect(tokens.verify(token)).toBeUndefined();
  });
  it('never extends past the absolute lifetime', () => {
    const now = 5_000_000;
    const tokens = new WidgetSessionTokens('s'.repeat(32), () => now);
    const { claims } = tokens.issue({ t: tenantA, a: assistant, o: origin, m: now + 60_000 });
    expect(claims.e).toBe(now + 60_000);
  });
  it('rejects short secrets', () => {
    expect(() => new WidgetSessionTokens('short')).toThrow();
  });
});

describe('WidgetService public access', () => {
  it('issues a session only for an enabled widget and an allowed origin, returning public config only', async () => {
    const { service } = build();
    const result = await service.createSession(KEY, origin, 'hi', '203.0.113.5');
    expect(result.sessionToken).toMatch(/^mzw_/);
    expect(result.config).toMatchObject({ name: 'Shop', defaultLanguage: 'hi', voice: { available: true, speechLanguages: ['en', 'hi'], textOnlyLanguages: ['te'] } });
    const text = JSON.stringify(result);
    expect(text).not.toContain(tenantA);
    expect(text).not.toContain(KEY);
  });
  it.each([
    ['unknown origin', { origin: 'https://evil.example.test' }],
    ['missing origin', { origin: undefined }],
    ['wildcard-looking origin', { origin: 'https://shop.example.test.evil.test' }],
  ])('rejects %s', async (_name, input) => {
    const { service } = build();
    await expect(service.createSession(KEY, input.origin, undefined, 'p')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects disabled widgets, empty allowlists and unknown keys identically', async () => {
    await expect(build({ settings: { enabled: false } }).service.createSession(KEY, origin, undefined, 'p')).rejects.toThrow('unavailable');
    await expect(build({ settings: { allowedOrigins: [] } }).service.createSession(KEY, origin, undefined, 'p')).rejects.toThrow('unavailable');
    await expect(build().service.createSession(`wk_${'b'.repeat(32)}`, origin, undefined, 'p')).rejects.toThrow('unavailable');
  });
  it('rate limits session creation per client', async () => {
    const { service } = build();
    for (let i = 0; i < 20; i++) await service.createSession(KEY, origin, undefined, 'same-ip');
    await expect(service.createSession(KEY, origin, undefined, 'same-ip')).rejects.toMatchObject({ status: 429 });
  });

  it('answers through the agent with tenant context and widget-only permissions, then persists the conversation id', async () => {
    const { service, agent, repository } = build();
    const { sessionToken } = await service.createSession(KEY, origin, undefined, 'p');
    let ambient: unknown;
    agent.ask.mockImplementation(async () => { ambient = tenantContextStore.get(); return { success: true, answer: 'Hi', model: 'secret-model', toolCalls: [], sources: [] }; });
    const first = await service.ask(sessionToken, origin, 'Hello', 'en');
    expect(first).not.toHaveProperty('model');
    expect(first).not.toHaveProperty('toolCalls');
    expect(repository.createWidgetConversation).toHaveBeenCalledWith(tenantA, assistant, 'en');
    expect(ambient).toMatchObject({ tenantId: tenantA, actorType: 'widget', permissions: WIDGET_PERMISSIONS });
    const [, context] = agent.ask.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(context).toMatchObject({ tenantId: tenantA, channel: 'widget', modality: 'text', assistantId: assistant });
    expect(context).not.toHaveProperty('userId');
    expect(context.permissions).not.toContain('conversations:manage');
    await service.ask(first.sessionToken, origin, 'Again', undefined);
    expect(repository.createWidgetConversation).toHaveBeenCalledTimes(1);
  });
  it('returns structured product cards from the agent to the public widget', async () => {
    const { service, agent } = build();
    const { sessionToken } = await service.createSession(KEY, origin, undefined, 'p');
    const card = {
      externalProductId: 'sku-1', name: 'Tea', productUrl: 'https://shop.example.test/tea',
      images: ['https://shop.example.test/tea.jpg'], price: 2500, salePrice: 1800, currency: 'INR',
    };
    agent.ask.mockImplementation(async () => ({ success: true, answer: 'Tea', model: 'm', toolCalls: [], sources: [], products: [card] }) as never);
    const result = await service.ask(sessionToken, origin, 'Tea?', undefined);
    expect(result.products).toEqual([card]);
    agent.ask.mockImplementation(async () => ({ success: true, answer: 'Hi', model: 'm', toolCalls: [], sources: [] }));
    expect(await service.ask(result.sessionToken, origin, 'Hi', undefined)).not.toHaveProperty('products');
  });
  it('rejects tokens from another origin, tampered tokens, and revoked domains', async () => {
    const { service, repository } = build();
    const { sessionToken } = await service.createSession(KEY, origin, undefined, 'p');
    await expect(service.ask(sessionToken, 'https://evil.example.test', 'hi', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.ask(`${sessionToken}x`, origin, 'hi', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.ask(undefined, origin, 'hi', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    repository.findForTenant.mockResolvedValueOnce({ tenantId: tenantA, settings: settings({ allowedOrigins: [] }) });
    await expect(service.ask(sessionToken, origin, 'hi', undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('preserves verified cart navigation in public text responses', async () => {
    const { service, agent } = build();
    const { sessionToken } = await service.createSession(KEY, origin, undefined, 'p');
    const navigationAction = { id: 'a'.repeat(64), type: 'OPEN_CHECKOUT', url: `${origin}/checkout`, merchantOrigin: origin };
    const cartOperation = {
      operation: 'add_to_cart', productId: 'zenage', productName: 'ZENAGE', quantity: 1,
      cartVerified: true, cartUrl: `${origin}/cart`, checkoutUrl: navigationAction.url, navigationAction,
    };
    agent.ask.mockImplementation(async () => ({
      success: true, answer: 'ZENAGE has been added to your cart.', model: 'verified-cart', toolCalls: [], sources: [],
      cartOperation, navigationAction,
    }));
    const result = await service.ask(sessionToken, origin, 'Add ZENAGE to my cart.', 'en');
    expect(result).toMatchObject({ success: true, cartVerified: true, cartOperation, navigationAction });
  });
  it('never lets a session reach another tenant (tenant is fixed by the signed token)', async () => {
    const { service, repository, agent } = build();
    const { sessionToken } = await service.createSession(KEY, origin, undefined, 'p');
    await service.ask(sessionToken, origin, 'hi', undefined);
    expect(repository.findForTenant).toHaveBeenCalledWith(tenantA);
    expect((agent.ask.mock.calls[0] as unknown as [string, { tenantId: string }])[1].tenantId).toBe(tenantA);
  });
  it('rate limits messages per session', async () => {
    const { service } = build();
    const { sessionToken } = await service.createSession(KEY, origin, undefined, 'p');
    for (let i = 0; i < 12; i++) await service.ask(sessionToken, origin, 'hi', undefined);
    await expect(service.ask(sessionToken, origin, 'hi', undefined)).rejects.toMatchObject({ status: 429 });
  });
  it('allows one in-flight request per session', async () => {
    const { service, agent } = build();
    const { sessionToken } = await service.createSession(KEY, origin, undefined, 'p');
    let release!: () => void;
    agent.ask.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ success: true, answer: 'x', model: 'm', toolCalls: [], sources: [] }); }));
    const pending = service.ask(sessionToken, origin, 'one', undefined);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(service.ask(sessionToken, origin, 'two', undefined)).rejects.toMatchObject({ status: 429 });
    release();
    await pending;
  });
});

describe('WidgetService admin', () => {
  const user = newUuidv7();
  function inTenant<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContextStore.run({ tenantId: tenantA, actorType: 'user', userId: user, permissions: ['tenants:write'] }, fn);
  }
  it('always uses the verified tenant and validates assistant ownership', async () => {
    const { service, repository } = build();
    await inTenant(() => service.getSettings());
    expect(repository.getOrCreate).toHaveBeenCalledWith(tenantA);
    repository.resolveAssistant.mockResolvedValueOnce(undefined as never);
    await expect(inTenant(() => service.updateSettings({ assistantId: newUuidv7() }, user))).rejects.toBeInstanceOf(BadRequestException);
    await inTenant(() => service.updateSettings({ name: 'New' }, user));
    expect(repository.update).toHaveBeenCalledWith(tenantA, { name: 'New' }, user);
  });
  it('fails closed without tenant context', async () => {
    expect(() => build().service.getSettings()).toThrow();
  });
  it('rotates the key within the tenant', async () => {
    const { service, repository } = build();
    await inTenant(() => service.rotateKey(user));
    expect(repository.rotateKey).toHaveBeenCalledWith(tenantA, user);
  });
});


describe('widget voice', () => {
  async function session(b = build()) {
    const { sessionToken } = await b.service.createSession(KEY, origin, undefined, 'p');
    return { ...b, sessionToken };
  }

  it('reports voice unavailable when the voice service says so (no assumption from config)', async () => {
    const b = build();
    b.voice.availability.mockResolvedValue({ available: false, speechLanguages: [], textOnlyLanguages: [] });
    const result = await b.service.createSession(KEY, origin, undefined, 'p');
    expect(result.config.voice.available).toBe(false);
  });

  it('issues an origin-bound ticket bound to tenant, assistant, widget session and a new conversation', async () => {
    const { service, voice, repository, sessionToken } = await session();
    const result = await service.voiceTicket(sessionToken, origin);
    expect(result.ticket).toMatch(/^mzt_/);
    const bound = (voice.issueTicket.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(bound).toMatchObject({ tenantId: tenantA, assistantId: assistant, origin });
    expect(bound.widgetSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bound.conversationId).toBe(result.conversationId);
    expect(repository.createWidgetConversation).toHaveBeenCalledTimes(1);
    // The refreshed session token carries the conversation so text and voice continue the same transcript.
    const again = await service.voiceTicket(result.sessionToken, origin);
    expect(again.conversationId).toBe(result.conversationId);
    expect(repository.createWidgetConversation).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, forged, cross-origin and stale sessions', async () => {
    const { service, sessionToken } = await session();
    await expect(service.voiceTicket(undefined, origin)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.voiceTicket(sessionToken + 'x', origin)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.voiceTicket(sessionToken, 'https://evil.example.test')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.voiceTicket(sessionToken, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('re-checks the allowlist and enabled state at ticket time', async () => {
    const b = await session();
    b.repository.findForTenant.mockResolvedValue({ tenantId: tenantA, settings: settings({ allowedOrigins: [] }) });
    await expect(b.service.voiceTicket(b.sessionToken, origin)).rejects.toBeInstanceOf(ForbiddenException);
    b.repository.findForTenant.mockResolvedValue({ tenantId: tenantA, settings: settings({ enabled: false }) });
    await expect(b.service.voiceTicket(b.sessionToken, origin)).rejects.toBeInstanceOf(ForbiddenException);
    expect(b.voice.issueTicket).not.toHaveBeenCalled();
  });

  it('rate limits tickets per widget session through shared state', async () => {
    const { service, sessionToken } = await session();
    for (let i = 0; i < 6; i++) await service.voiceTicket(sessionToken, origin);
    await expect(service.voiceTicket(sessionToken, origin)).rejects.toMatchObject({ status: 429 });
  });

  it('shares rate limits between service instances that use the same store', async () => {
    process.env.MCZEN_WIDGET_SESSION_SECRET = 's'.repeat(40);
    const a = await session();
    const second = new WidgetService(a.repository as never, a.agent as never, a.store, a.voice as never);
    for (let i = 0; i < 6; i++) await a.service.voiceTicket(a.sessionToken, origin);
    await expect(second.voiceTicket(a.sessionToken, origin)).rejects.toMatchObject({ status: 429 });
    delete process.env.MCZEN_WIDGET_SESSION_SECRET;
  });
});

describe('SharedRateLimiter', () => {
  it('fails closed with 503 when the store is unavailable', async () => {
    
    const limiter = new SharedRateLimiter({ hit: jest.fn().mockRejectedValue(new SharedStateUnavailableError()) } as never);
    await expect(limiter.hit('k', 5)).rejects.toMatchObject({ status: 503 });
  });
});