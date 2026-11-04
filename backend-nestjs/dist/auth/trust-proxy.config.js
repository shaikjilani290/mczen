"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrustProxyConfigError = void 0;
exports.readTrustProxySetting = readTrustProxySetting;
const node_net_1 = require("node:net");
class TrustProxyConfigError extends Error {
}
exports.TrustProxyConfigError = TrustProxyConfigError;
function readTrustProxySetting(env = process.env) {
    const raw = env.MCZEN_TRUST_PROXY?.trim();
    if (raw === undefined || raw === '')
        return false;
    const proxies = raw.split(',').map((entry) => entry.trim());
    if (proxies.some((entry) => entry === '')) {
        throw new TrustProxyConfigError('MCZEN_TRUST_PROXY must be a comma-separated list of explicit IP addresses without empty entries.');
    }
    for (const proxy of proxies) {
        if ((0, node_net_1.isIP)(proxy) === 0) {
            throw new TrustProxyConfigError('MCZEN_TRUST_PROXY accepts only explicit IP addresses (for example the local Nginx address).');
        }
    }
    return proxies;
}
//# sourceMappingURL=trust-proxy.config.js.map