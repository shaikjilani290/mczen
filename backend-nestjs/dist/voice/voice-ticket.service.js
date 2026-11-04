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
exports.VoiceTicketService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const shared_state_1 = require("../shared-state/shared-state");
const TICKET_TTL_MS = 30_000;
let VoiceTicketService = class VoiceTicketService {
    store;
    constructor(store) {
        this.store = store;
    }
    async issue(user, tenant, origin) {
        const normalizedOrigin = validateOrigin(origin);
        if (tenant.actorType !== 'user' || tenant.userId !== user.userId ||
            tenant.tenantId !== user.activeTenantId ||
            !tenant.permissions.includes('conversations:write')) {
            throw new common_1.ForbiddenException('Voice access is unavailable.');
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
    async issueIdentity(identity, origin) {
        return this.store_({ identity: { ...identity, permissions: [...identity.permissions] }, origin: validateOrigin(origin) });
    }
    async consume(ticket, origin) {
        if (typeof ticket !== 'string' || !/^mzt_[A-Za-z0-9_-]{43}$/.test(ticket)) {
            throw new common_1.UnauthorizedException('Voice authentication failed.');
        }
        let raw;
        try {
            raw = await this.store.take(this.key(ticket));
        }
        catch (error) {
            throw unavailable(error);
        }
        if (!raw)
            throw new common_1.UnauthorizedException('Voice authentication failed.');
        const record = JSON.parse(raw);
        if (record.origin !== validateOrigin(origin))
            throw new common_1.UnauthorizedException('Voice authentication failed.');
        return Object.freeze({ ...record.identity, permissions: Object.freeze([...record.identity.permissions]) });
    }
    async store_(record) {
        const ticket = `mzt_${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
        try {
            await this.store.put(this.key(ticket), JSON.stringify(record), TICKET_TTL_MS);
        }
        catch (error) {
            throw unavailable(error);
        }
        return { ticket, expiresInMs: TICKET_TTL_MS };
    }
    key(ticket) {
        return `vt:${(0, node_crypto_1.createHash)('sha256').update(ticket).digest('hex')}`;
    }
};
exports.VoiceTicketService = VoiceTicketService;
exports.VoiceTicketService = VoiceTicketService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(shared_state_1.SHARED_STATE)),
    __metadata("design:paramtypes", [Object])
], VoiceTicketService);
function unavailable(error) {
    return error instanceof shared_state_1.SharedStateUnavailableError
        ? new common_1.ServiceUnavailableException('Voice service is temporarily unavailable.')
        : error;
}
function validateOrigin(origin) {
    if (!origin)
        throw new common_1.ForbiddenException('A browser origin is required for voice access.');
    try {
        const parsed = new URL(origin);
        if (parsed.origin !== origin || parsed.username || parsed.password ||
            !['http:', 'https:'].includes(parsed.protocol))
            throw new Error();
        return parsed.origin;
    }
    catch {
        throw new common_1.ForbiddenException('Voice access is unavailable for this origin.');
    }
}
//# sourceMappingURL=voice-ticket.service.js.map