import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './auth-context';
import { RateLimitService } from './rate-limit.service';
import { readTrustProxySetting } from './trust-proxy.config';
import { WEBSITE_PUBLIC_PATHS, WIDGET_PUBLIC_PATH, widgetCorsOptions } from './cors.config';

export function corsOptionsForPath(path: string, cors: CorsOptions): CorsOptions {
  const publicBrowserIntegration = WEBSITE_PUBLIC_PATHS.includes(path);
  return path.startsWith(WIDGET_PUBLIC_PATH) || publicBrowserIntegration ? widgetCorsOptions : cors;
}

/** Call before app.init/listen so the IP limiter precedes Nest's body parser. */
export function configureHttpApplication(app: INestApplication, cors: CorsOptions): void {
  const express = app.getHttpAdapter().getInstance();
  // Forwarding headers stay untrusted unless MCZEN_TRUST_PROXY explicitly names
  // the proxy (e.g. the local Nginx), which overwrites X-Forwarded-For. The
  // localhost dev-token gate never consults these headers regardless.
  express.set('trust proxy', readTrustProxySetting());
  express.disable('x-powered-by');
  const rate = app.get(RateLimitService);
  app.use((request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    try {
      rate.checkEdge(request, response);
      next();
    } catch (error) {
      next(error); // The global safe exception filter also covers middleware.
    }
  });
  app.enableCors((request: { url?: string }, callback: (error: Error | null, options?: CorsOptions) => void) => {
    const path = (request.url ?? '').split('?')[0];
    callback(null, corsOptionsForPath(path, cors));
  });
}
