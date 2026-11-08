"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WidgetSessionTokens = exports.WIDGET_SESSION_MAX_MS = exports.WIDGET_SESSION_TTL_MS = void 0;
const node_crypto_1 = require("node:crypto");
const PREFIX = 'mzw_';
exports.WIDGET_SESSION_TTL_MS = 30 * 60_000;
exports.WIDGET_SESSION_MAX_MS = 8 * 60 * 60_000;
class WidgetSessionTokens {
    now;
    key;
    constructor(secret = process.env.MCZEN_WIDGET_SESSION_SECRET, now = Date.now) {
        this.now = now;
        if (secret !== undefined && secret !== '' && secret.length < 32)
            throw new Error('MCZEN_WIDGET_SESSION_SECRET must be at least 32 characters.');
        this.key = secret ? Buffer.from(secret, 'utf8') : (0, node_crypto_1.randomBytes)(32);
    }
    issue(base) {
        const now = this.now();
        const m = base.m ?? now + exports.WIDGET_SESSION_MAX_MS;
        const claims = { ...base, e: Math.min(now + exports.WIDGET_SESSION_TTL_MS, m), m };
        const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
        return { token: `${PREFIX}${body}.${this.sign(body)}`, claims };
    }
    verify(token) {
        if (typeof token !== 'string' || !token.startsWith(PREFIX) || token.length > 1024)
            return undefined;
        const [body, signature, extra] = token.slice(PREFIX.length).split('.');
        if (!body || !signature || extra !== undefined)
            return undefined;
        const expected = Buffer.from(this.sign(body));
        const actual = Buffer.from(signature);
        if (expected.length !== actual.length || !(0, node_crypto_1.timingSafeEqual)(expected, actual))
            return undefined;
        try {
            const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
            const now = this.now();
            if (typeof claims.t !== 'string' || typeof claims.a !== 'string' || typeof claims.o !== 'string' ||
                typeof claims.e !== 'number' || typeof claims.m !== 'number' || claims.e <= now || claims.m <= now ||
                (claims.s !== undefined && (typeof claims.s !== 'string' || !/^[0-9a-f-]{36}$/.test(claims.s))) ||
                (claims.i !== undefined && (typeof claims.i !== 'string' || !/^[0-9a-f-]{36}$/.test(claims.i))) ||
                (claims.k !== undefined && (typeof claims.k !== 'string' || !/^[a-f0-9]{64}$/.test(claims.k))))
                return undefined;
            return claims;
        }
        catch {
            return undefined;
        }
    }
    sign(body) {
        return (0, node_crypto_1.createHmac)('sha256', this.key).update(body).digest('base64url');
    }
}
exports.WidgetSessionTokens = WidgetSessionTokens;
//# sourceMappingURL=widget-session.tokens.js.map