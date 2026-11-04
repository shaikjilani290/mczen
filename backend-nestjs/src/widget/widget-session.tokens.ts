import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface WidgetSessionClaims {
  /** tenant id */ t: string;
  /** assistant id */ a: string;
  /** conversation id once the first turn has started */ c?: string;
  /** stable anonymous session id, preserved across token refreshes; binds voice tickets */ s?: string;
  /** embedding origin the session was issued to */ o: string;
  /** sliding expiry (epoch ms) */ e: number;
  /** absolute expiry (epoch ms) */ m: number;
}

const PREFIX = 'mzw_';
export const WIDGET_SESSION_TTL_MS = 30 * 60_000;
export const WIDGET_SESSION_MAX_MS = 8 * 60 * 60_000;

/**
 * Stateless, HMAC-signed widget session credential. The key is process-local
 * unless MCZEN_WIDGET_SESSION_SECRET is set, so sessions do not survive a restart
 * and are not shared between instances. It carries no permissions: it can only
 * ask the tenant's widget assistant questions from the origin it was issued to.
 */
export class WidgetSessionTokens {
  private readonly key: Buffer;

  constructor(secret = process.env.MCZEN_WIDGET_SESSION_SECRET, private readonly now: () => number = Date.now) {
    if (secret !== undefined && secret !== '' && secret.length < 32) throw new Error('MCZEN_WIDGET_SESSION_SECRET must be at least 32 characters.');
    this.key = secret ? Buffer.from(secret, 'utf8') : randomBytes(32);
  }

  issue(base: Omit<WidgetSessionClaims, 'e' | 'm'> & { m?: number }): { token: string; claims: WidgetSessionClaims } {
    const now = this.now();
    const m = base.m ?? now + WIDGET_SESSION_MAX_MS;
    const claims: WidgetSessionClaims = { ...base, e: Math.min(now + WIDGET_SESSION_TTL_MS, m), m };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return { token: `${PREFIX}${body}.${this.sign(body)}`, claims };
  }

  verify(token: unknown): WidgetSessionClaims | undefined {
    if (typeof token !== 'string' || !token.startsWith(PREFIX) || token.length > 1024) return undefined;
    const [body, signature, extra] = token.slice(PREFIX.length).split('.');
    if (!body || !signature || extra !== undefined) return undefined;
    const expected = Buffer.from(this.sign(body));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
    try {
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as WidgetSessionClaims;
      const now = this.now();
      if (typeof claims.t !== 'string' || typeof claims.a !== 'string' || typeof claims.o !== 'string' ||
          typeof claims.e !== 'number' || typeof claims.m !== 'number' || claims.e <= now || claims.m <= now ||
          (claims.s !== undefined && (typeof claims.s !== 'string' || !/^[0-9a-f-]{36}$/.test(claims.s)))) return undefined;
      return claims;
    } catch {
      return undefined;
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}
