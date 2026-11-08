import { readCorsOptions, widgetCorsOptions } from './cors.config';
import { corsOptionsForPath } from './http.config';

describe('public website integration CORS', () => {
  const dashboardCors = readCorsOptions({
    NODE_ENV: 'production',
    MCZEN_CORS_ORIGINS: 'https://dashboard.example.test',
  });

  it.each([
    '/api/website-integrations/connect',
    '/api/website-integrations/message',
    '/api/website-integrations/voice-ticket',
    '/api/website-integrations/product-context',
    '/api/website-integrations/cart/poll',
    '/api/website-integrations/cart/result',
    '/api/website-ingestion/page-view',
  ])('allows browser CORS only for the public session route %s', (path) => {
    expect(corsOptionsForPath(path, dashboardCors)).toBe(widgetCorsOptions);
  });

  it('does not open browser CORS for server-side ingestion credentials', () => {
    expect(corsOptionsForPath('/api/website-ingestion/batch', dashboardCors)).toBe(dashboardCors);
    expect(widgetCorsOptions.credentials).toBe(false);
  });
});
