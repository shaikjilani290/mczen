import { BadRequestException } from '@nestjs/common';
import { isUuidv7 } from '../common/ids/uuid';

export const WIDGET_LANGUAGES = ['en', 'hi', 'te'] as const;
export type WidgetLanguage = (typeof WIDGET_LANGUAGES)[number];
export const WIDGET_THEMES = ['light', 'dark', 'auto'] as const;
export const WIDGET_POSITIONS = ['bottom-right', 'bottom-left'] as const;
export const WIDGET_BUTTON_STYLES = ['round', 'pill', 'square'] as const;
const MAX_ORIGINS = 20;
const PUBLIC_KEY = /^wk_[A-Za-z0-9_-]{32,60}$/;

export interface WidgetSettingsUpdate {
  enabled?: boolean;
  assistantId?: string | null;
  name?: string;
  logoUrl?: string | null;
  primaryColor?: string;
  theme?: (typeof WIDGET_THEMES)[number];
  position?: (typeof WIDGET_POSITIONS)[number];
  buttonStyle?: (typeof WIDGET_BUTTON_STYLES)[number];
  welcomeMessage?: string | null;
  initialGreeting?: string | null;
  allowedOrigins?: string[];
}

function record(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('A JSON object is required.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new BadRequestException('The request contains unsupported fields.');
  return input;
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new BadRequestException(`${field} is invalid.`);
  const trimmed = value.trim();
  // Control characters have no place in widget copy.
  if (trimmed.length < min || trimmed.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
    throw new BadRequestException(`${field} is invalid.`);
  }
  return trimmed;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) throw new BadRequestException(`${field} is invalid.`);
  return value as T;
}

/** Exact web origin only (scheme + host + optional port). HTTP is limited to loopback outside production. */
export function normalizeOrigin(value: unknown, production = process.env.NODE_ENV === 'production'): string {
  if (typeof value !== 'string' || value.length > 253) throw new BadRequestException('An allowed origin is invalid.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new BadRequestException('An allowed origin is invalid.'); }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && loopback && !production);
  if (!schemeOk || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) {
    throw new BadRequestException('Allowed origins must be exact HTTPS origins without paths or wildcards.');
  }
  return url.origin;
}

export function parseWidgetSettingsUpdate(body: unknown): WidgetSettingsUpdate {
  const input = record(body, ['enabled', 'assistantId', 'name', 'logoUrl', 'primaryColor', 'theme', 'position', 'buttonStyle',
    'welcomeMessage', 'initialGreeting', 'allowedOrigins']);
  const out: WidgetSettingsUpdate = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new BadRequestException('enabled is invalid.');
    out.enabled = input.enabled;
  }
  if (input.assistantId !== undefined) {
    if (input.assistantId !== null && (typeof input.assistantId !== 'string' || !isUuidv7(input.assistantId))) throw new BadRequestException('assistantId is invalid.');
    out.assistantId = input.assistantId as string | null;
  }
  if (input.name !== undefined) out.name = text(input.name, 'name', 1, 100);
  if (input.logoUrl !== undefined) {
    if (input.logoUrl === null || input.logoUrl === '') out.logoUrl = null;
    else {
      const raw = text(input.logoUrl, 'logoUrl', 1, 500);
      let url: URL;
      try { url = new URL(raw); } catch { throw new BadRequestException('logoUrl is invalid.'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new BadRequestException('logoUrl must be an HTTPS URL.');
      out.logoUrl = url.toString();
    }
  }
  if (input.primaryColor !== undefined) {
    if (typeof input.primaryColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.primaryColor)) throw new BadRequestException('primaryColor must be #RRGGBB.');
    out.primaryColor = input.primaryColor.toLowerCase();
  }
  if (input.theme !== undefined) out.theme = oneOf(input.theme, WIDGET_THEMES, 'theme');
  if (input.position !== undefined) out.position = oneOf(input.position, WIDGET_POSITIONS, 'position');
  if (input.buttonStyle !== undefined) out.buttonStyle = oneOf(input.buttonStyle, WIDGET_BUTTON_STYLES, 'buttonStyle');
  if (input.welcomeMessage !== undefined) out.welcomeMessage = input.welcomeMessage === null ? null : text(input.welcomeMessage, 'welcomeMessage', 0, 300) || null;
  if (input.initialGreeting !== undefined) out.initialGreeting = input.initialGreeting === null ? null : text(input.initialGreeting, 'initialGreeting', 0, 1000) || null;
  if (input.allowedOrigins !== undefined) {
    if (!Array.isArray(input.allowedOrigins) || input.allowedOrigins.length > MAX_ORIGINS) throw new BadRequestException('allowedOrigins is invalid.');
    out.allowedOrigins = [...new Set(input.allowedOrigins.map((origin) => normalizeOrigin(origin)))];
  }
  if (Object.keys(out).length === 0) throw new BadRequestException('No changes were supplied.');
  return out;
}

export function isPublicKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_KEY.test(value);
}

export function parsePublicSession(body: unknown): { publicKey: string; language?: WidgetLanguage } {
  const input = record(body, ['publicKey', 'language']);
  if (!isPublicKey(input.publicKey)) throw new BadRequestException('The widget key is invalid.');
  return {
    publicKey: input.publicKey,
    ...(input.language !== undefined ? { language: oneOf(input.language, WIDGET_LANGUAGES, 'language') } : {}),
  };
}

export function parsePublicMessage(body: unknown): { message: string; language?: WidgetLanguage } {
  const input = record(body, ['message', 'language']);
  return {
    message: text(input.message, 'message', 1, 2000),
    ...(input.language !== undefined ? { language: oneOf(input.language, WIDGET_LANGUAGES, 'language') } : {}),
  };
}

export interface DateRange { from: Date; to: Date }

/** Inclusive UTC day range; defaults to the last 30 days and is capped at 366 days. */
export function parseDateRange(query: Record<string, unknown>, now = new Date()): DateRange {
  const day = (value: unknown, field: string): Date => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} must be YYYY-MM-DD.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} is invalid.`);
    return date;
  };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = query.to === undefined ? today : day(query.to, 'to');
  const from = query.from === undefined ? new Date(to.getTime() - 29 * 86_400_000) : day(query.from, 'from');
  if (from > to) throw new BadRequestException('from must not be after to.');
  if ((to.getTime() - from.getTime()) / 86_400_000 > 365) throw new BadRequestException('The date range is limited to 366 days.');
  // Exclusive upper bound makes the final day inclusive.
  return { from, to: new Date(to.getTime() + 86_400_000) };
}

export function parseTenantStatus(body: unknown): { status: 'active' | 'suspended'; reason: string | null } {
  const input = record(body, ['status', 'reason']);
  return {
    status: oneOf(input.status, ['active', 'suspended'] as const, 'status'),
    reason: input.reason === undefined || input.reason === null ? null : text(input.reason, 'reason', 1, 255),
  };
}
