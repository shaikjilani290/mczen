export type AuditMetadata = Record<string, string | number | boolean | null>;

const MAX_KEYS = 20;
const MAX_STRING = 200;
// Keys that could carry credentials or sensitive payloads are dropped, never masked.
const FORBIDDEN_KEY = /pass|secret|token|key|cipher|authorization|cookie|audio|value|credential|email|phone|ticket|hash/i;
// Values that look like credentials are dropped even under an innocuous key.
const SECRET_VALUE = /(^|\s)(bearer\s+\S+|(mzt|wk|sk)_[A-Za-z0-9_-]{8,})|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i;

/** Keeps flat scalar metadata only; drops sensitive keys and credential-looking values. */
export function sanitizeMetadata(input: unknown): AuditMetadata | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const output: AuditMetadata = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(output).length >= MAX_KEYS) break;
    if (key.length > 40 || FORBIDDEN_KEY.test(key)) continue;
    if (value === null || typeof value === 'boolean') output[key] = value;
    else if (typeof value === 'number') { if (Number.isFinite(value)) output[key] = value; }
    else if (typeof value === 'string') {
      if (SECRET_VALUE.test(value)) continue;
      output[key] = value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}
