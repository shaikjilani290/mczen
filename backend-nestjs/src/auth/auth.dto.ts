import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { isOpaqueToken } from './token.service';

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  tenantName?: string;
  tenantSlug?: string;
  inviteToken?: string;
}

export interface LoginInput { email: string; password: string }
export interface LogoutInput { refreshToken?: string; allSessions?: boolean }

/** No raw input/validation value is ever attached to an exception. */
export function bodyObject(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.getPrototypeOf(body) !== Object.prototype || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new BadRequestException('Invalid request body.');
  }
  return body as Record<string, unknown>;
}

export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 255) return undefined;
  const email = value.trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email) ? email : undefined;
}

/** Passphrases allowed; never trim, normalize or silently truncate a password. */
export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new BadRequestException('The password must be 12 to 128 characters long.');
  }
}

export function parseRegisterInput(body: unknown): RegisterInput {
  const input = bodyObject(body, ['email', 'password', 'name', 'tenantName', 'tenantSlug', 'inviteToken', 'invite_token']);
  const email = normalizeEmail(input.email);
  if (!email) throw new BadRequestException('A valid email address is required.');
  validatePassword(input.password);
  if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 150)) {
    throw new BadRequestException('Name must be at most 150 characters.');
  }
  if (input.inviteToken !== undefined && input.invite_token !== undefined) throw new BadRequestException('Provide only one invite token field.');
  const inviteToken = input.inviteToken ?? input.invite_token;
  const dto: RegisterInput = { email, password: input.password, name: input.name as string | undefined };
  if (inviteToken !== undefined) {
    if (!isOpaqueToken(inviteToken, 'mzp_') || input.tenantName !== undefined || input.tenantSlug !== undefined) {
      throw new BadRequestException('Invalid invite registration.');
    }
    return { ...dto, inviteToken };
  }
  if (typeof input.tenantName !== 'string' || !input.tenantName.trim() || input.tenantName.length > 150 ||
    typeof input.tenantSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(input.tenantSlug)) {
    throw new BadRequestException('Provide a workspace name (1–150 characters) and identifier (2–63 lowercase letters, digits or hyphens).');
  }
  return { ...dto, tenantName: input.tenantName.trim(), tenantSlug: input.tenantSlug };
}

export function parseLoginInput(body: unknown): LoginInput {
  const input = bodyObject(body, ['email', 'password']);
  const email = normalizeEmail(input.email);
  if (!email || typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 128) {
    throw new UnauthorizedException('Invalid email or password.');
  }
  return { email, password: input.password };
}

export function parseLogoutInput(body: unknown): LogoutInput {
  const input = bodyObject(body ?? {}, ['refreshToken', 'allSessions']);
  if ((input.refreshToken !== undefined && !isOpaqueToken(input.refreshToken, 'mzr_')) ||
    (input.allSessions !== undefined && typeof input.allSessions !== 'boolean')) {
    throw new BadRequestException('Invalid logout request.');
  }
  return input as LogoutInput;
}
