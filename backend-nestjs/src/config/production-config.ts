import { resolveSharedStateConfig } from '../shared-state/shared-state.config';
import { readTrustProxySetting } from '../auth/trust-proxy.config';

type Env = Record<string, string | undefined>;

export interface ConfigProblem {
  variable: string;
  problem: string;
}

export class ProductionConfigError extends Error {
  constructor(readonly problems: readonly ConfigProblem[]) {
    super(`Invalid production configuration: ${problems.map((p) => `${p.variable} (${p.problem})`).join('; ')}`);
    this.name = 'ProductionConfigError';
  }
}

const PLACEHOLDER = /change[-_ ]?me|example|placeholder|your[-_ ]|secret[-_ ]?here|^x+$/i;

function validMasterKey(raw: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return true;
  try { return Buffer.from(raw, 'base64').length === 32; } catch { return false; }
}

/**
 * Pure check of the production environment. It reports variable NAMES and a fixed reason only, never a value,
 * so the result is safe to log. Returns an empty list outside production.
 */
export function validateProductionConfig(env: Env = process.env): ConfigProblem[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: ConfigProblem[] = [];
  const add = (variable: string, problem: string) => problems.push({ variable, problem });

  const jwt = env.JWT_SECRET;
  if (!jwt) add('JWT_SECRET', 'required');
  else if (Buffer.byteLength(jwt) < 32) add('JWT_SECRET', 'must be at least 32 bytes');
  else if (PLACEHOLDER.test(jwt)) add('JWT_SECRET', 'looks like a placeholder');

  const master = env.SECRET_MASTER_KEY?.trim();
  if (!master) add('SECRET_MASTER_KEY', 'required');
  else if (!validMasterKey(master)) add('SECRET_MASTER_KEY', 'must be 64 hex characters or 32 bytes of base64');
  else if (PLACEHOLDER.test(master)) add('SECRET_MASTER_KEY', 'looks like a placeholder');
  const version = env.SECRET_MASTER_KEY_VERSION;
  if (version !== undefined && !/^[1-9]\d{0,8}$/.test(version)) add('SECRET_MASTER_KEY_VERSION', 'must be a positive integer');

  const widget = env.MCZEN_WIDGET_SESSION_SECRET;
  if (!widget) add('MCZEN_WIDGET_SESSION_SECRET', 'required (a random key would break sessions across restarts and instances)');
  else if (widget.length < 32) add('MCZEN_WIDGET_SESSION_SECRET', 'must be at least 32 characters');
  else if (widget === jwt) add('MCZEN_WIDGET_SESSION_SECRET', 'must differ from JWT_SECRET');

  for (const [name, alt] of [['DB_HOST'], ['DB_PORT'], ['DB_USERNAME', 'DB_USER'], ['DB_DATABASE', 'DB_NAME']] as const) {
    if (!env[name] && !(alt && env[alt])) add(name, 'required');
  }
  if (!env.DB_PASSWORD) add('DB_PASSWORD', 'required in production');
  if (env.DB_PORT && !/^\d{1,5}$/.test(env.DB_PORT)) add('DB_PORT', 'must be a port number');

  try { resolveSharedStateConfig(env); } catch (error) {
    add('SHARED_STATE_DRIVER/REDIS_URL', error instanceof Error ? error.message : 'invalid');
  }

  // Fail closed in production when MCZEN_TRUST_PROXY is set to anything other
  // than explicit proxy IP addresses (never `true`, hostnames or wildcards).
  try { readTrustProxySetting(env); } catch {
    add('MCZEN_TRUST_PROXY', 'must be empty or comma-separated explicit IP addresses (for example the local Nginx address)');
  }

  if (!env.MCZEN_CORS_ORIGINS?.trim()) add('MCZEN_CORS_ORIGINS', 'required (exact HTTPS dashboard origins)');
  if (env.MCZEN_ALLOW_DEV_HEADER === '1') add('MCZEN_ALLOW_DEV_HEADER', 'must not be enabled in production');
  if (env.MCZEN_EXPOSE_DEV_AUTH_TOKENS === '1') add('MCZEN_EXPOSE_DEV_AUTH_TOKENS', 'must not be enabled in production');
  return problems;
}

/** Throws before the HTTP server starts when production configuration is incomplete or unsafe. */
export function assertProductionConfig(env: Env = process.env): void {
  const problems = validateProductionConfig(env);
  if (problems.length > 0) throw new ProductionConfigError(problems);
}
