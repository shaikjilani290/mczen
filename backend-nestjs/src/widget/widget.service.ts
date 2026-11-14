import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AgentService } from '../agent/agent.service';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { tenantContextStore, type TenantContext } from '../common/tenant/tenant-context.store';
import { type WidgetSettingsUpdate, type WidgetLanguage, normalizeOrigin } from './widget.dto';
import { WidgetRepository, type WidgetSettingsView } from './widget.repository';
import { WidgetSessionTokens, type WidgetSessionClaims } from './widget-session.tokens';
import { SharedRateLimiter, tooManyRequests } from '../shared-state/rate-limiter';
import { SHARED_STATE, type SharedState } from '../shared-state/shared-state';
import { WidgetVoiceService } from '../voice/widget-voice.service';
import { WebsiteIntegrationRepository } from '../website-integrations/website-integration.repository';
import { parsePageView } from '../website-integrations/website-integration.dto';
import { MerchantCartService } from '../website-integrations/merchant-cart.service';

/** Anonymous visitors may only use public catalogue tools; orders, school and matrimonial stay private. */
export const WIDGET_PERMISSIONS = Object.freeze(['knowledge:read', 'products:read', 'inventory:read']);
const UNAVAILABLE = 'The assistant widget is unavailable.';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);
  private readonly tokens = new WidgetSessionTokens();
  private readonly limiter: SharedRateLimiter;
  /** Per-instance guard against overlapping turns of one session; the shared rate limit still bounds total throughput. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repository: WidgetRepository,
    private readonly agent: AgentService,
    @Inject(SHARED_STATE) store: SharedState,
    private readonly voice: WidgetVoiceService,
    @Optional() private readonly websiteIntegrations?: WebsiteIntegrationRepository,
    @Optional() private readonly merchantCart?: MerchantCartService,
  ) {
    this.limiter = new SharedRateLimiter(store);
  }

  // ---- Tenant admin (tenant comes only from the verified context) ----

  private tenant(): TenantContext { return tenantContextStore.getOrThrow(); }

  getSettings(): Promise<WidgetSettingsView> { return this.repository.getOrCreate(this.tenant().tenantId); }

  async updateSettings(input: WidgetSettingsUpdate, userId: string): Promise<WidgetSettingsView> {
    const tenantId = this.tenant().tenantId;
    if (input.assistantId) {
      const resolved = await this.repository.resolveAssistant(tenantId, input.assistantId);
      if (resolved?.id !== input.assistantId) throw new BadRequestException('assistantId is invalid.');
    }
    const result = await this.repository.update(tenantId, input, userId);
    this.audit('widget.settings.updated', tenantId, userId, Object.keys(input));
    return result;
  }

  async rotateKey(userId: string): Promise<WidgetSettingsView> {
    const tenantId = this.tenant().tenantId;
    const result = await this.repository.rotateKey(tenantId, userId);
    this.audit('widget.key.rotated', tenantId, userId, ['publicKey']);
    return result;
  }

  analytics(range: Parameters<WidgetRepository['analytics']>[1]) {
    return this.repository.analytics(this.tenant().tenantId, range);
  }

  // ---- Public widget (no ambient identity; every call re-validates key/origin/tenant) ----

  async createSession(
    publicKey: string,
    origin: string | undefined,
    language: WidgetLanguage | undefined,
    peer: string | undefined,
    assistantId?: string,
  ) {
    await this.limiter.hit(`session:ip:${digest(peer ?? 'unknown')}`, 20);
    await this.limiter.hit(`session:key:${digest(publicKey)}`, 120);
    if (publicKey.startsWith('mzp_')) {
      return this.createWebsiteSession(publicKey, origin, language, assistantId);
    }
    const target = await this.repository.findByPublicKey(publicKey);
    const allowedOrigin = this.requireOrigin(target?.settings, origin);
    if (!target || !allowedOrigin) throw new ForbiddenException(UNAVAILABLE);
    const assistant = await this.repository.resolveAssistant(target.tenantId, target.settings.assistantId);
    if (!assistant) throw new ForbiddenException(UNAVAILABLE);
    const { token, claims } = this.tokens.issue({ t: target.tenantId, a: assistant.id, o: allowedOrigin, s: randomUUID() });
    const initial = language && assistant.languages.includes(language) ? language : assistant.defaultLanguage;
    const s = target.settings;
    const voice = await this.voice.availability(target.tenantId, assistant.id);
    return {
      sessionToken: token,
      expiresAt: new Date(claims.e).toISOString(),
      config: {
        name: s.name, logoUrl: s.logoUrl, primaryColor: s.primaryColor, theme: s.theme, position: s.position,
        buttonStyle: s.buttonStyle, welcomeMessage: s.welcomeMessage,
        greeting: s.initialGreeting ?? assistant.greeting,
        languages: assistant.languages, defaultLanguage: initial,
        // Derived from live sidecar health and the assistant's persisted voice settings, never from config alone.
        voice,
      },
    };
  }

  /** Issues a short-lived, single-use, origin-bound WebSocket ticket for anonymous widget voice. */
  async voiceTicket(sessionToken: string | undefined, origin: string | undefined) {
    const since = performance.now();
    const diagnose = (stage: string) => this.logger.log({
      event: 'widget_voice_ticket_stage', stage, elapsedMs: Math.round(performance.now() - since),
    });
    diagnose('request_received');
    const claims = this.tokens.verify(sessionToken);
    if (!claims || !origin || claims.o !== origin || !claims.s) throw new UnauthorizedException('The widget session is invalid or expired.');
    await this.limiter.hit(`vt:session:${claims.s}`, 6);
    await this.limiter.hit(`vt:tenant:${claims.t}`, 120);
    if (claims.i) await this.requireWebsiteSession(claims, origin);
    else {
      const target = await this.repository.findForTenant(claims.t);
      if (!target || !this.requireOrigin(target.settings, origin)) throw new ForbiddenException(UNAVAILABLE);
    }
    diagnose('session_and_origin_validated');
    const assistant = await this.repository.resolveAssistant(claims.t, claims.a);
    if (!assistant || assistant.id !== claims.a) throw new ForbiddenException(UNAVAILABLE);
    const tenant: TenantContext = { tenantId: claims.t, actorType: 'widget', assistantId: assistant.id, permissions: WIDGET_PERMISSIONS, requestId: randomUUID() };
    const conversationId = claims.c ?? await tenantContextStore.run(tenant, () =>
      this.repository.createWidgetConversation(claims.t, assistant.id, assistant.defaultLanguage));
    diagnose('assistant_and_conversation_resolved');
    const issued = await this.voice.issueTicket({
      tenantId: claims.t, assistantId: assistant.id, conversationId, widgetSessionId: claims.s, origin,
      ...(claims.i ? { merchant: { integrationId: claims.i, sessionId: claims.s, origin } } : {}),
    });
    const { token, claims: next } = this.tokens.issue({
      t: claims.t, a: claims.a, c: conversationId, o: claims.o, s: claims.s,
      ...(claims.i ? { i: claims.i, k: claims.k } : {}), m: claims.m,
    });
    diagnose('ticket_issued');
    return {
      ticket: issued.ticket, expiresInMs: issued.expiresInMs, conversationId,
      voice: issued.availability, sessionToken: token, expiresAt: new Date(next.e).toISOString(),
    };
  }

  async ask(sessionToken: string | undefined, origin: string | undefined, message: string, language: WidgetLanguage | undefined, requestId?: string) {
    const claims = this.tokens.verify(sessionToken);
    if (!claims || !origin || claims.o !== origin) throw new UnauthorizedException('The widget session is invalid or expired.');
    const sessionKey = claims.s ?? digest(sessionToken as string);
    await this.limiter.hit(`msg:session:${sessionKey}`, 12);
    await this.limiter.hit(`msg:tenant:${claims.t}`, 240);
    if (this.inFlight.has(sessionKey)) throw tooManyRequests();

    if (claims.i) await this.requireWebsiteSession(claims, origin);
    else {
      const target = await this.repository.findForTenant(claims.t);
      // Origin and enabled state are re-checked so a removed domain or disabled widget stops immediately.
      if (!target || !this.requireOrigin(target.settings, origin)) throw new ForbiddenException(UNAVAILABLE);
    }
    const assistant = await this.repository.resolveAssistant(claims.t, claims.a);
    if (!assistant || assistant.id !== claims.a) throw new ForbiddenException(UNAVAILABLE);

    this.inFlight.add(sessionKey);
    try {
      const tenant: TenantContext = { tenantId: claims.t, actorType: 'widget', assistantId: assistant.id, permissions: WIDGET_PERMISSIONS,
        requestId: requestId && claims.i ? digest(`${claims.s}:${requestId}:${message}`) : randomUUID() };
      return await tenantContextStore.run(tenant, async () => {
        const conversationId = claims.c ?? await this.repository.createWidgetConversation(claims.t, assistant.id, language ?? assistant.defaultLanguage);
        const context: AgentExecutionContext = {
          tenantId: claims.t, conversationId, assistantId: assistant.id, channel: 'widget', modality: 'text',
          ...(language ? { language } : {}), permissions: WIDGET_PERMISSIONS, requestId: tenant.requestId as string,
          ...(claims.i && claims.s ? { merchant: { integrationId: claims.i, sessionId: claims.s, origin } } : {}),
        };
        const result = await this.agent.ask(message, context);
        const { token, claims: next } = this.tokens.issue({
          t: claims.t, a: claims.a, c: conversationId, o: claims.o, ...(claims.s ? { s: claims.s } : {}),
          ...(claims.i ? { i: claims.i, k: claims.k } : {}), m: claims.m,
        });
        return {
          success: result.success, answer: result.answer, sources: result.sources,
          ...(result.products?.length ? { products: result.products } : {}),
          ...(result.cartOperation ? { ...result.cartOperation, cartOperation: result.cartOperation } : {}),
          ...(result.navigationAction ? { navigationAction: result.navigationAction } : {}),
          sessionToken: token, expiresAt: new Date(next.e).toISOString(),
        };
      });
    } finally {
      this.inFlight.delete(sessionKey);
    }
  }

  private async createWebsiteSession(
    publicKey: string, origin: string | undefined, language?: WidgetLanguage, requestedAssistantId?: string,
  ) {
      let normalizedOrigin: string;
      try { normalizedOrigin = normalizeOrigin(origin); } catch { throw new ForbiddenException(UNAVAILABLE); }
      const integration = await this.websiteIntegrations?.byPublicKey(publicKey);
      if (!integration || integration.origin !== normalizedOrigin ||
          (requestedAssistantId && requestedAssistantId !== integration.assistantId)) {
        throw new ForbiddenException(UNAVAILABLE);
      }
      const assistant = await this.repository.resolveAssistant(integration.tenantId, integration.assistantId);
      if (!assistant || assistant.id !== integration.assistantId) throw new ForbiddenException(UNAVAILABLE);
      const sessionId = randomUUID();
      const { token, claims } = this.tokens.issue({
        t: integration.tenantId, a: assistant.id, o: normalizedOrigin, s: sessionId,
        i: integration.id, k: digest(integration.publicKey),
      });
      const initial = language && assistant.languages.includes(language) ? language : assistant.defaultLanguage;
      const voice = await this.voice.availability(integration.tenantId, assistant.id);
      return {
        sessionToken: token,
        expiresAt: new Date(claims.e).toISOString(),
        config: {
          name: integration.name, logoUrl: null, primaryColor: '#0f766e', theme: 'auto',
          position: 'bottom-right', buttonStyle: 'round', welcomeMessage: null,
          greeting: assistant.greeting, languages: assistant.languages, defaultLanguage: initial, voice,
        },
      };
    }

  private async requireWebsiteSession(claims: WidgetSessionClaims, origin: string | undefined): Promise<void> {
      if (!claims.i || !claims.s || !origin || claims.o !== origin || !this.websiteIntegrations) {
        throw new ForbiddenException(UNAVAILABLE);
      }

      const integration = await this.websiteIntegrations.activeRecord(claims.t, claims.i);
      let normalizedOrigin: string;
      try { normalizedOrigin = normalizeOrigin(origin); } catch { throw new ForbiddenException(UNAVAILABLE); }
      if (!integration || integration.assistantId !== claims.a || integration.origin !== normalizedOrigin ||
          claims.k !== digest(integration.publicKey)) {
        throw new ForbiddenException(UNAVAILABLE);
      }
    }

  async productContext(sessionToken: string | undefined, origin: string | undefined, body: unknown) {
    const claims = this.tokens.verify(sessionToken);
    if (!claims?.i || !claims.s || !origin) {
      throw new UnauthorizedException('The merchant customer session is invalid or expired.');
    }
    await this.requireWebsiteSession(claims, origin);
    await this.limiter.hit(`product-context:${claims.s}`, 60);
    if (!this.merchantCart) throw new BadRequestException('Product page context is unavailable.');
    return this.merchantCart.rememberProductContext(
      claims.t, { integrationId: claims.i, sessionId: claims.s, origin }, claims.a, body,
    );
  }

  async trackWebsitePage(sessionToken: string | undefined, origin: string | undefined, body: unknown) {
    const claims = this.tokens.verify(sessionToken);
    if (!claims?.i || !claims.s) throw new UnauthorizedException('The website session is invalid or expired.');
    await this.requireWebsiteSession(claims, origin);
    await this.limiter.hit(`pageview:session:${claims.s}`, 120);
    const input = parsePageView(body);
    if (new URL(input.pageUrl).origin !== claims.o) throw new ForbiddenException(UNAVAILABLE);
    await this.websiteIntegrations?.trackPage({
      tenantId: claims.t, integrationId: claims.i, visitorId: claims.s,
      pageUrl: input.pageUrl, pageHash: digest(input.pageUrl), title: input.title, referrer: input.referrer,
    });
    return { tracked: true };
  }

  async cartBridge(sessionToken: string | undefined, origin: string | undefined, body: unknown, complete = false) {
    const claims = this.tokens.verify(sessionToken);
    if (!claims?.i || !claims.s || !origin) throw new UnauthorizedException('The merchant customer session is invalid or expired.');
    await this.requireWebsiteSession(claims, origin);
    if (!this.merchantCart) throw new BadRequestException('The merchant cart adapter is unavailable.');
    await this.limiter.hit(`cartbridge:session:${claims.s}`, 240);
    const binding = { integrationId: claims.i, sessionId: claims.s, origin };
    return complete ? this.merchantCart.complete(claims.t, binding, body) : this.merchantCart.poll(claims.t, binding, body);
  }

  /** Returns the matched exact origin, or undefined when the widget cannot serve this origin. */
  private requireOrigin(settings: WidgetSettingsView | undefined, origin: string | undefined): string | undefined {
    if (!settings?.enabled || !origin) return undefined;
    let normalized: string;
    try { normalized = normalizeOrigin(origin); } catch { return undefined; }
    return settings.allowedOrigins.includes(normalized) ? normalized : undefined;
  }

  private audit(event: string, tenantId: string, userId: string, fields: string[]): void {
    // Field names only; values (e.g. origins, keys) never enter logs.
    this.logger.log(JSON.stringify({ event, tenantId, userId, fields }));
  }
}
