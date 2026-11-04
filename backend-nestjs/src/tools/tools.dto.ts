import { BadRequestException } from '@nestjs/common';

export interface TenantToolUpdate {
  enabled?: boolean;
  extraPermissions?: string[];
  config?: Record<string, unknown>;
}

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new BadRequestException('A JSON object is required.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new BadRequestException('The request contains an unsupported field.');
  }
  return record;
}

export function parseTenantToolUpdate(value: unknown): TenantToolUpdate {
  const raw = object(value, ['enabled', 'extraPermissions', 'config']);
  const result: TenantToolUpdate = {};
  if ('enabled' in raw) {
    if (typeof raw.enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean.');
    result.enabled = raw.enabled;
  }
  if ('extraPermissions' in raw) {
    if (!Array.isArray(raw.extraPermissions) || raw.extraPermissions.length > 20 ||
        raw.extraPermissions.some((p) => typeof p !== 'string' || !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(p))) {
      throw new BadRequestException('extraPermissions must contain valid permission keys.');
    }
    result.extraPermissions = [...new Set(raw.extraPermissions as string[])];
  }
  if ('config' in raw) {
    if (!raw.config || typeof raw.config !== 'object' || Array.isArray(raw.config)) {
      throw new BadRequestException('config must be a JSON object.');
    }
    result.config = raw.config as Record<string, unknown>;
  }
  if (!Object.keys(result).length) throw new BadRequestException('At least one setting is required.');
  return result;
}

export function parseAssistantToolUpdate(value: unknown): boolean {
  const raw = object(value, ['enabled']);
  if (typeof raw.enabled !== 'boolean') throw new BadRequestException('enabled must be a boolean.');
  return raw.enabled;
}

export function parseToolSecret(value: unknown): { value: string; expiresAt: string | null } {
  const raw = object(value, ['value', 'expiresAt']);
  if (typeof raw.value !== 'string' || raw.value.length < 1 || raw.value.length > 1024) {
    throw new BadRequestException('Secret value must contain between 1 and 1024 characters.');
  }
  let expiresAt: string | null = null;
  if (raw.expiresAt !== undefined && raw.expiresAt !== null) {
    if (typeof raw.expiresAt !== 'string' || !Number.isFinite(Date.parse(raw.expiresAt))) {
      throw new BadRequestException('expiresAt must be a valid ISO date or null.');
    }
    expiresAt = new Date(raw.expiresAt).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) throw new BadRequestException('expiresAt must be in the future.');
  }
  return { value: raw.value, expiresAt };
}

export function validateToolReference(value: string): string {
  if (!(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) || /^[1-9]\d{0,19}$/.test(value))) {
    throw new BadRequestException('Tool not found.');
  }
  return value;
}
