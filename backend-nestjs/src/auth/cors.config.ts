import { ForbiddenException } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { DEV_TENANT_HEADER } from '../agent/context/tenant-context.service';

export class CorsConfigError extends Error {}

/**
 * Public widget routes are called from tenant websites, so the browser-level check reflects
 * the origin and the widget service enforces the per-tenant exact allowlist on every request.
 * No credentials are allowed; the session token travels in the Authorization header.
 */
export const WIDGET_PUBLIC_PATH = '/api/widget/public/';
export const WEBSITE_PUBLIC_PATHS = Object.freeze([
  '/api/website-integrations/connect',
  '/api/website-integrations/message',
  '/api/website-integrations/voice-ticket',
  '/api/website-integrations/product-context',
  '/api/website-integrations/cart/poll',
  '/api/website-integrations/cart/result',
  '/api/website-ingestion/page-view',
]);
export const widgetCorsOptions: CorsOptions = {
  origin: true,
  credentials: false,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Retry-After'],
  maxAge: 600,
};

/** Exact dashboard origins, no wildcards/credentials; widget origins are validated per tenant. */
export function readCorsOptions(env: Record<string, string | undefined> = process.env): CorsOptions {
  const production = env.NODE_ENV === 'production';
  const raw = env.MCZEN_CORS_ORIGINS ?? (production ? '' : 'http://localhost:5174,http://127.0.0.1:5174');
  if (raw.length > 8192) throw new CorsConfigError('MCZEN_CORS_ORIGINS is too long.');
  const origins = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (origins.length > 32) throw new CorsConfigError('MCZEN_CORS_ORIGINS allows at most 32 origins.');
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password || !['https:', ...(production ? [] : ['http:'])].includes(url.protocol)) throw new Error();
    } catch { throw new CorsConfigError('MCZEN_CORS_ORIGINS must contain exact HTTP(S) origins; production requires HTTPS.'); }
  }
  const allowed = new Set(origins);
  return {
    origin: (origin, callback) => {
      if (origin === undefined || allowed.has(origin)) callback(null, true);
      else callback(new ForbiddenException('Origin is not allowed.'), false);
    },
    credentials: false,
    // PATCH/PUT/DELETE are required by the tenant admin APIs (6D assistants, 6E knowledge).
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', ...(!production && env.MCZEN_ALLOW_DEV_HEADER === '1' ? [DEV_TENANT_HEADER] : [])],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Content-Disposition'],
    maxAge: 600,
  };
}
