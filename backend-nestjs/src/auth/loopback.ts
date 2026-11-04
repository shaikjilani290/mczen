import type { RequestHeaders } from '../agent/context/tenant-context.service';

/** Raw socket peer only. Forwarded headers never make an external request local. */
export function isDirectLoopback(headers: RequestHeaders, remoteAddress?: string): boolean {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress ?? '') &&
    ['forwarded', 'x-forwarded-for', 'x-real-ip', 'x-forwarded-host'].every((key) => headers[key] === undefined);
}

export function allowDevelopmentTokens(headers: RequestHeaders, remoteAddress?: string): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.MCZEN_EXPOSE_DEV_AUTH_TOKENS === '1' &&
    isDirectLoopback(headers, remoteAddress);
}
