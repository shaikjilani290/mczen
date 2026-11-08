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
var WidgetService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WidgetService = exports.WIDGET_PERMISSIONS = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const agent_service_1 = require("../agent/agent.service");
const tenant_context_store_1 = require("../common/tenant/tenant-context.store");
const widget_dto_1 = require("./widget.dto");
const widget_repository_1 = require("./widget.repository");
const widget_session_tokens_1 = require("./widget-session.tokens");
const rate_limiter_1 = require("../shared-state/rate-limiter");
const shared_state_1 = require("../shared-state/shared-state");
const widget_voice_service_1 = require("../voice/widget-voice.service");
const website_integration_repository_1 = require("../website-integrations/website-integration.repository");
const website_integration_dto_1 = require("../website-integrations/website-integration.dto");
const merchant_cart_service_1 = require("../website-integrations/merchant-cart.service");
exports.WIDGET_PERMISSIONS = Object.freeze(['knowledge:read', 'products:read', 'inventory:read']);
const UNAVAILABLE = 'The assistant widget is unavailable.';
const digest = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
let WidgetService = WidgetService_1 = class WidgetService {
    repository;
    agent;
    voice;
    websiteIntegrations;
    merchantCart;
    logger = new common_1.Logger(WidgetService_1.name);
    tokens = new widget_session_tokens_1.WidgetSessionTokens();
    limiter;
    inFlight = new Set();
    constructor(repository, agent, store, voice, websiteIntegrations, merchantCart) {
        this.repository = repository;
        this.agent = agent;
        this.voice = voice;
        this.websiteIntegrations = websiteIntegrations;
        this.merchantCart = merchantCart;
        this.limiter = new rate_limiter_1.SharedRateLimiter(store);
    }
    tenant() { return tenant_context_store_1.tenantContextStore.getOrThrow(); }
    getSettings() { return this.repository.getOrCreate(this.tenant().tenantId); }
    async updateSettings(input, userId) {
        const tenantId = this.tenant().tenantId;
        if (input.assistantId) {
            const resolved = await this.repository.resolveAssistant(tenantId, input.assistantId);
            if (resolved?.id !== input.assistantId)
                throw new common_1.BadRequestException('assistantId is invalid.');
        }
        const result = await this.repository.update(tenantId, input, userId);
        this.audit('widget.settings.updated', tenantId, userId, Object.keys(input));
        return result;
    }
    async rotateKey(userId) {
        const tenantId = this.tenant().tenantId;
        const result = await this.repository.rotateKey(tenantId, userId);
        this.audit('widget.key.rotated', tenantId, userId, ['publicKey']);
        return result;
    }
    analytics(range) {
        return this.repository.analytics(this.tenant().tenantId, range);
    }
    async createSession(publicKey, origin, language, peer, assistantId) {
        await this.limiter.hit(`session:ip:${digest(peer ?? 'unknown')}`, 20);
        await this.limiter.hit(`session:key:${digest(publicKey)}`, 120);
        if (publicKey.startsWith('mzp_')) {
            return this.createWebsiteSession(publicKey, origin, language, assistantId);
        }
        const target = await this.repository.findByPublicKey(publicKey);
        const allowedOrigin = this.requireOrigin(target?.settings, origin);
        if (!target || !allowedOrigin)
            throw new common_1.ForbiddenException(UNAVAILABLE);
        const assistant = await this.repository.resolveAssistant(target.tenantId, target.settings.assistantId);
        if (!assistant)
            throw new common_1.ForbiddenException(UNAVAILABLE);
        const { token, claims } = this.tokens.issue({ t: target.tenantId, a: assistant.id, o: allowedOrigin, s: (0, node_crypto_1.randomUUID)() });
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
                voice,
            },
        };
    }
    async voiceTicket(sessionToken, origin) {
        const since = performance.now();
        const diagnose = (stage) => this.logger.log({
            event: 'widget_voice_ticket_stage', stage, elapsedMs: Math.round(performance.now() - since),
        });
        diagnose('request_received');
        const claims = this.tokens.verify(sessionToken);
        if (!claims || !origin || claims.o !== origin || !claims.s)
            throw new common_1.UnauthorizedException('The widget session is invalid or expired.');
        await this.limiter.hit(`vt:session:${claims.s}`, 6);
        await this.limiter.hit(`vt:tenant:${claims.t}`, 120);
        if (claims.i)
            await this.requireWebsiteSession(claims, origin);
        else {
            const target = await this.repository.findForTenant(claims.t);
            if (!target || !this.requireOrigin(target.settings, origin))
                throw new common_1.ForbiddenException(UNAVAILABLE);
        }
        diagnose('session_and_origin_validated');
        const assistant = await this.repository.resolveAssistant(claims.t, claims.a);
        if (!assistant || assistant.id !== claims.a)
            throw new common_1.ForbiddenException(UNAVAILABLE);
        const tenant = { tenantId: claims.t, actorType: 'widget', assistantId: assistant.id, permissions: exports.WIDGET_PERMISSIONS, requestId: (0, node_crypto_1.randomUUID)() };
        const conversationId = claims.c ?? await tenant_context_store_1.tenantContextStore.run(tenant, () => this.repository.createWidgetConversation(claims.t, assistant.id, assistant.defaultLanguage));
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
    async ask(sessionToken, origin, message, language, requestId) {
        const claims = this.tokens.verify(sessionToken);
        if (!claims || !origin || claims.o !== origin)
            throw new common_1.UnauthorizedException('The widget session is invalid or expired.');
        const sessionKey = claims.s ?? digest(sessionToken);
        await this.limiter.hit(`msg:session:${sessionKey}`, 12);
        await this.limiter.hit(`msg:tenant:${claims.t}`, 240);
        if (this.inFlight.has(sessionKey))
            throw (0, rate_limiter_1.tooManyRequests)();
        if (claims.i)
            await this.requireWebsiteSession(claims, origin);
        else {
            const target = await this.repository.findForTenant(claims.t);
            if (!target || !this.requireOrigin(target.settings, origin))
                throw new common_1.ForbiddenException(UNAVAILABLE);
        }
        const assistant = await this.repository.resolveAssistant(claims.t, claims.a);
        if (!assistant || assistant.id !== claims.a)
            throw new common_1.ForbiddenException(UNAVAILABLE);
        this.inFlight.add(sessionKey);
        try {
            const tenant = { tenantId: claims.t, actorType: 'widget', assistantId: assistant.id, permissions: exports.WIDGET_PERMISSIONS,
                requestId: requestId && claims.i ? digest(`${claims.s}:${requestId}:${message}`) : (0, node_crypto_1.randomUUID)() };
            return await tenant_context_store_1.tenantContextStore.run(tenant, async () => {
                const conversationId = claims.c ?? await this.repository.createWidgetConversation(claims.t, assistant.id, language ?? assistant.defaultLanguage);
                const context = {
                    tenantId: claims.t, conversationId, assistantId: assistant.id, channel: 'widget', modality: 'text',
                    ...(language ? { language } : {}), permissions: exports.WIDGET_PERMISSIONS, requestId: tenant.requestId,
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
                    sessionToken: token, expiresAt: new Date(next.e).toISOString(),
                };
            });
        }
        finally {
            this.inFlight.delete(sessionKey);
        }
    }
    async createWebsiteSession(publicKey, origin, language, requestedAssistantId) {
        let normalizedOrigin;
        try {
            normalizedOrigin = (0, widget_dto_1.normalizeOrigin)(origin);
        }
        catch {
            throw new common_1.ForbiddenException(UNAVAILABLE);
        }
        const integration = await this.websiteIntegrations?.byPublicKey(publicKey);
        if (!integration || integration.origin !== normalizedOrigin ||
            (requestedAssistantId && requestedAssistantId !== integration.assistantId)) {
            throw new common_1.ForbiddenException(UNAVAILABLE);
        }
        const assistant = await this.repository.resolveAssistant(integration.tenantId, integration.assistantId);
        if (!assistant || assistant.id !== integration.assistantId)
            throw new common_1.ForbiddenException(UNAVAILABLE);
        const sessionId = (0, node_crypto_1.randomUUID)();
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
    async requireWebsiteSession(claims, origin) {
        if (!claims.i || !claims.s || !origin || claims.o !== origin || !this.websiteIntegrations) {
            throw new common_1.ForbiddenException(UNAVAILABLE);
        }
        const integration = await this.websiteIntegrations.activeRecord(claims.t, claims.i);
        let normalizedOrigin;
        try {
            normalizedOrigin = (0, widget_dto_1.normalizeOrigin)(origin);
        }
        catch {
            throw new common_1.ForbiddenException(UNAVAILABLE);
        }
        if (!integration || integration.assistantId !== claims.a || integration.origin !== normalizedOrigin ||
            claims.k !== digest(integration.publicKey)) {
            throw new common_1.ForbiddenException(UNAVAILABLE);
        }
    }
    async productContext(sessionToken, origin, body) {
        const claims = this.tokens.verify(sessionToken);
        if (!claims?.i || !claims.s || !origin) {
            throw new common_1.UnauthorizedException('The merchant customer session is invalid or expired.');
        }
        await this.requireWebsiteSession(claims, origin);
        await this.limiter.hit(`product-context:${claims.s}`, 60);
        if (!this.merchantCart)
            throw new common_1.BadRequestException('Product page context is unavailable.');
        return this.merchantCart.rememberProductContext(claims.t, { integrationId: claims.i, sessionId: claims.s, origin }, claims.a, body);
    }
    async trackWebsitePage(sessionToken, origin, body) {
        const claims = this.tokens.verify(sessionToken);
        if (!claims?.i || !claims.s)
            throw new common_1.UnauthorizedException('The website session is invalid or expired.');
        await this.requireWebsiteSession(claims, origin);
        await this.limiter.hit(`pageview:session:${claims.s}`, 120);
        const input = (0, website_integration_dto_1.parsePageView)(body);
        if (new URL(input.pageUrl).origin !== claims.o)
            throw new common_1.ForbiddenException(UNAVAILABLE);
        await this.websiteIntegrations?.trackPage({
            tenantId: claims.t, integrationId: claims.i, visitorId: claims.s,
            pageUrl: input.pageUrl, pageHash: digest(input.pageUrl), title: input.title, referrer: input.referrer,
        });
        return { tracked: true };
    }
    async cartBridge(sessionToken, origin, body, complete = false) {
        const claims = this.tokens.verify(sessionToken);
        if (!claims?.i || !claims.s || !origin)
            throw new common_1.UnauthorizedException('The merchant customer session is invalid or expired.');
        await this.requireWebsiteSession(claims, origin);
        if (!this.merchantCart)
            throw new common_1.BadRequestException('The merchant cart adapter is unavailable.');
        await this.limiter.hit(`cartbridge:session:${claims.s}`, 240);
        const binding = { integrationId: claims.i, sessionId: claims.s, origin };
        return complete ? this.merchantCart.complete(claims.t, binding, body) : this.merchantCart.poll(claims.t, binding, body);
    }
    requireOrigin(settings, origin) {
        if (!settings?.enabled || !origin)
            return undefined;
        let normalized;
        try {
            normalized = (0, widget_dto_1.normalizeOrigin)(origin);
        }
        catch {
            return undefined;
        }
        return settings.allowedOrigins.includes(normalized) ? normalized : undefined;
    }
    audit(event, tenantId, userId, fields) {
        this.logger.log(JSON.stringify({ event, tenantId, userId, fields }));
    }
};
exports.WidgetService = WidgetService;
exports.WidgetService = WidgetService = WidgetService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(shared_state_1.SHARED_STATE)),
    __param(4, (0, common_1.Optional)()),
    __param(5, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [widget_repository_1.WidgetRepository,
        agent_service_1.AgentService, Object, widget_voice_service_1.WidgetVoiceService,
        website_integration_repository_1.WebsiteIntegrationRepository,
        merchant_cart_service_1.MerchantCartService])
], WidgetService);
//# sourceMappingURL=widget.service.js.map