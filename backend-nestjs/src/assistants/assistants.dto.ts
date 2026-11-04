import { BadRequestException } from '@nestjs/common';
import { bodyObject } from '../auth/auth.dto';

export const LANGUAGES = ['en', 'hi', 'te'] as const;
export type Language = (typeof LANGUAGES)[number];
export const STT_PROVIDERS = ['browser', 'faster-whisper', 'whisper-api', 'google'] as const;
export const TTS_PROVIDERS = ['browser', 'piper', 'elevenlabs', 'google'] as const;
export const VOICE_GENDERS = ['female', 'male', 'neutral'] as const;
export const RESPONSE_STYLES = ['concise', 'balanced', 'detailed'] as const;
export const STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export const SECRET_KINDS = ['stt', 'tts'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export const MAX_SYSTEM_PROMPT = 16000;

const invalid = (): never => {
  throw new BadRequestException('Invalid request body.');
};

function text(v: unknown, max: number, opts: { min?: number; nullable?: boolean } = {}): string | null {
  if (v === null && opts.nullable) return null;
  if (typeof v !== 'string') return invalid();
  const s = v.trim();
  if (s.length < (opts.min ?? 0) || s.length > max) return invalid();
  if (s === '' && opts.nullable) return null;
  return s;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : invalid();
}

function bool(v: unknown): boolean {
  return typeof v === 'boolean' ? v : invalid();
}

function range(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return invalid();
  return Math.round(v * 100) / 100;
}

/** Only `https://` URLs; no embedded credentials. */
function httpsUrl(v: unknown): string | null {
  const s = text(v, 500, { nullable: true });
  if (s === null) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return invalid();
  } catch {
    return invalid();
  }
  return s;
}

export interface CreateAssistantInput {
  name: string;
  description?: string | null;
  systemPrompt?: string;
}

export function parseCreateAssistant(body: unknown): CreateAssistantInput {
  const b = bodyObject(body, ['name', 'description', 'systemPrompt']);
  const out: CreateAssistantInput = { name: text(b.name, 100, { min: 1 }) as string };
  if ('description' in b) out.description = text(b.description, 500, { nullable: true });
  if ('systemPrompt' in b) out.systemPrompt = text(b.systemPrompt, MAX_SYSTEM_PROMPT, { min: 1 }) as string;
  return out;
}

export interface UpdateAssistantInput {
  profile?: {
    name?: string;
    description?: string | null;
    personality?: string | null;
    greetingMessage?: string | null;
    fallbackMessage?: string | null;
    status?: (typeof STATUSES)[number];
  };
  language?: { mode?: 'auto' | 'manual'; defaultLanguage?: Language; enabled?: Language[] };
  voice?: {
    speechEnabled?: boolean;
    autoSpeak?: boolean;
    sttProvider?: (typeof STT_PROVIDERS)[number];
    ttsProvider?: (typeof TTS_PROVIDERS)[number];
    voiceGender?: (typeof VOICE_GENDERS)[number];
    voiceId?: string | null;
    speechRate?: number;
    speechPitch?: number;
  };
  branding?: { displayName?: string | null; primaryColor?: string | null; logoUrl?: string | null };
  preferences?: { responseStyle?: (typeof RESPONSE_STYLES)[number]; showSources?: boolean };
}

export function parseUpdateAssistant(body: unknown): UpdateAssistantInput {
  const b = bodyObject(body, ['profile', 'language', 'voice', 'branding', 'preferences']);
  const out: UpdateAssistantInput = {};

  if (b.profile !== undefined) {
    const p = bodyObject(b.profile, ['name', 'description', 'personality', 'greetingMessage', 'fallbackMessage', 'status']);
    const r: NonNullable<UpdateAssistantInput['profile']> = {};
    if ('name' in p) r.name = text(p.name, 100, { min: 1 }) as string;
    if ('description' in p) r.description = text(p.description, 500, { nullable: true });
    if ('personality' in p) r.personality = text(p.personality, 1000, { nullable: true });
    if ('greetingMessage' in p) r.greetingMessage = text(p.greetingMessage, 1000, { nullable: true });
    if ('fallbackMessage' in p) r.fallbackMessage = text(p.fallbackMessage, 1000, { nullable: true });
    if ('status' in p) r.status = oneOf(p.status, STATUSES);
    out.profile = r;
  }

  if (b.language !== undefined) {
    const l = bodyObject(b.language, ['mode', 'defaultLanguage', 'enabled']);
    const r: NonNullable<UpdateAssistantInput['language']> = {};
    if ('mode' in l) r.mode = oneOf(l.mode, ['auto', 'manual'] as const);
    if ('defaultLanguage' in l) r.defaultLanguage = oneOf(l.defaultLanguage, LANGUAGES);
    if ('enabled' in l) {
      if (!Array.isArray(l.enabled) || l.enabled.length < 1 || l.enabled.length > LANGUAGES.length) invalid();
      const list = (l.enabled as unknown[]).map((x) => oneOf(x, LANGUAGES));
      if (new Set(list).size !== list.length) invalid();
      r.enabled = list;
    }
    out.language = r;
  }

  if (b.voice !== undefined) {
    const v = bodyObject(b.voice, ['speechEnabled', 'autoSpeak', 'sttProvider', 'ttsProvider', 'voiceGender', 'voiceId', 'speechRate', 'speechPitch']);
    const r: NonNullable<UpdateAssistantInput['voice']> = {};
    if ('speechEnabled' in v) r.speechEnabled = bool(v.speechEnabled);
    if ('autoSpeak' in v) r.autoSpeak = bool(v.autoSpeak);
    if ('sttProvider' in v) r.sttProvider = oneOf(v.sttProvider, STT_PROVIDERS);
    if ('ttsProvider' in v) r.ttsProvider = oneOf(v.ttsProvider, TTS_PROVIDERS);
    if ('voiceGender' in v) r.voiceGender = oneOf(v.voiceGender, VOICE_GENDERS);
    if ('voiceId' in v) {
      r.voiceId = text(v.voiceId, 150, { nullable: true });
      if (r.voiceId !== null && !/^[A-Za-z0-9._:\- ]+$/.test(r.voiceId)) invalid();
    }
    if ('speechRate' in v) r.speechRate = range(v.speechRate, 0.5, 2);
    if ('speechPitch' in v) r.speechPitch = range(v.speechPitch, 0, 2);
    out.voice = r;
  }

  if (b.branding !== undefined) {
    const br = bodyObject(b.branding, ['displayName', 'primaryColor', 'logoUrl']);
    const r: NonNullable<UpdateAssistantInput['branding']> = {};
    if ('displayName' in br) r.displayName = text(br.displayName, 100, { nullable: true });
    if ('primaryColor' in br) {
      r.primaryColor = text(br.primaryColor, 7, { nullable: true });
      if (r.primaryColor !== null && !/^#[0-9a-fA-F]{6}$/.test(r.primaryColor)) invalid();
    }
    if ('logoUrl' in br) r.logoUrl = httpsUrl(br.logoUrl);
    out.branding = r;
  }

  if (b.preferences !== undefined) {
    const pr = bodyObject(b.preferences, ['responseStyle', 'showSources']);
    const r: NonNullable<UpdateAssistantInput['preferences']> = {};
    if ('responseStyle' in pr) r.responseStyle = oneOf(pr.responseStyle, RESPONSE_STYLES);
    if ('showSources' in pr) r.showSources = bool(pr.showSources);
    out.preferences = r;
  }

  if (Object.keys(out).length === 0) invalid();
  const lang = out.language;
  if (lang?.enabled && lang.defaultLanguage && !lang.enabled.includes(lang.defaultLanguage)) invalid();
  return out;
}

export interface InstructionsInput { systemPrompt: string; guardrailNotes?: string | null }

export function parseInstructions(body: unknown): InstructionsInput {
  const b = bodyObject(body, ['systemPrompt', 'guardrailNotes']);
  const out: InstructionsInput = { systemPrompt: text(b.systemPrompt, MAX_SYSTEM_PROMPT, { min: 1 }) as string };
  if ('guardrailNotes' in b) out.guardrailNotes = text(b.guardrailNotes, 2000, { nullable: true });
  return out;
}

export function parseSecretKind(value: unknown): SecretKind {
  return oneOf(value, SECRET_KINDS);
}

export function parseSecretInput(body: unknown): string {
  const b = bodyObject(body, ['apiKey']);
  const key = text(b.apiKey, 512, { min: 8 }) as string;
  if (/[\u0000-\u001f\u007f]/.test(key)) invalid();
  return key;
}
