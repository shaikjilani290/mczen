import { isIP } from 'node:net';

export class TrustProxyConfigError extends Error {}

/** `false` disables forwarding-header trust entirely; otherwise explicit proxy IP addresses. */
export type TrustProxySetting = false | string[];

/**
 * Parses MCZEN_TRUST_PROXY for Express `trust proxy`.
 *
 * Unset or empty keeps forwarding headers fully untrusted (Express then uses the
 * socket peer for `request.ip`), which is the safe default for direct exposure
 * and for every unit/e2e test. When set, ONLY explicit IP literals are accepted
 * — the deployment shape is one local Nginx on the same host (127.0.0.1), which
 * OVERWRITES X-Forwarded-For with $remote_addr. `true`, `1`, `loopback`,
 * hostnames, wildcards and CIDRs are rejected so a misconfiguration can never
 * broaden trust to arbitrary client-supplied X-Forwarded-For chains.
 *
 * Errors carry variable names and fixed reasons only, never the configured value.
 */
export function readTrustProxySetting(env: Record<string, string | undefined> = process.env): TrustProxySetting {
  const raw = env.MCZEN_TRUST_PROXY?.trim();
  if (raw === undefined || raw === '') return false;
  const proxies = raw.split(',').map((entry) => entry.trim());
  if (proxies.some((entry) => entry === '')) {
    throw new TrustProxyConfigError('MCZEN_TRUST_PROXY must be a comma-separated list of explicit IP addresses without empty entries.');
  }
  for (const proxy of proxies) {
    if (isIP(proxy) === 0) {
      throw new TrustProxyConfigError('MCZEN_TRUST_PROXY accepts only explicit IP addresses (for example the local Nginx address).');
    }
  }
  return proxies;
}
