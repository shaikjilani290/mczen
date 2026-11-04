"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDirectLoopback = isDirectLoopback;
exports.allowDevelopmentTokens = allowDevelopmentTokens;
function isDirectLoopback(headers, remoteAddress) {
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress ?? '') &&
        ['forwarded', 'x-forwarded-for', 'x-real-ip', 'x-forwarded-host'].every((key) => headers[key] === undefined);
}
function allowDevelopmentTokens(headers, remoteAddress) {
    return process.env.NODE_ENV !== 'production' && process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS === '1' &&
        isDirectLoopback(headers, remoteAddress);
}
//# sourceMappingURL=loopback.js.map