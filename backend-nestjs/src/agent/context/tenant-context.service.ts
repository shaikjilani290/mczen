import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AgentExecutionContext } from './agent-execution-context.interface';
import { tenantContextStore } from '../../common/tenant/tenant-context.store';
import { isDirectLoopback } from '../../auth/loopback';

/**
 * Legacy demo-only tenant header. Never an authentication credential.
 */
export const DEV_TENANT_HEADER = 'x-mczen-tenant-id';

/**
 * Development tenant identities used by the temporary dev resolver.
 * These are demo identities, never production ones.
 */
const DEV_TENANT_IDS: readonly string[] = [
  'tenant-a',
  'tenant-b',
  'tenant-c',
  'tenant-d',
];

/**
 * Phase 5 database-free demo permissions. Used ONLY by the explicit,
 * non-production, direct-loopback exception. JWT permissions are DB-backed.
 *
 * - tenant-a: e-commerce demo (products, orders, inventory)
 * - tenant-b: school supplies demo (school domain + its own catalogue)
 * - tenant-c: matrimonial demo
 * - tenant-d: healthcare demo (knowledge only)
 */
const DEV_TENANT_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'tenant-a': [
    'knowledge:read',
    'products:read',
    'products:write',
    'orders:read',
    'inventory:read',
  ],
  'tenant-b': [
    'knowledge:read',
    'school:read',
    'school:write',
    'products:read',
    'inventory:read',
  ],
  'tenant-c': ['knowledge:read', 'matrimonial:read'],
  'tenant-d': ['knowledge:read'],
};

/** Loose shape of Express/Nest request headers. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * Resolves the backend-established tenant context for a request.
 *
 * SECURITY CONTRACT (mandatory):
 * - The tenantId NEVER comes from AI-generated tool arguments — only from this
 *   service, which reads trusted request metadata.
 * - Normal resolution delegates to the immutable ALS snapshot established by
 *   TenantAuthGuard + TenantContextInterceptor; it accepts NO client metadata.
 * - The separate legacy path is called by the guard on the two agent routes
 *   only. It requires explicit opt-in + non-production + a direct loopback
 *   socket, and rejects forwarding headers. There is never a default tenant.
 */
@Injectable()
export class TenantContextService {
  resolve(): AgentExecutionContext {
    const context = tenantContextStore.getOrThrow();
    if (!context.requestId) throw new Error('The verified request context has no request identifier.');
    return Object.freeze({ tenantId: context.tenantId, userId: context.userId, assistantId: context.assistantId,
      permissions: context.permissions, requestId: context.requestId });
  }

  resolveDevelopment(headers: RequestHeaders, remoteAddress?: string, requestId = randomUUID()): AgentExecutionContext {
    if (this.isProduction() || process.env.MCZEN_ALLOW_DEV_HEADER !== '1' || !isDirectLoopback(headers, remoteAddress)) {
      throw new UnauthorizedException('Authentication required.');
    }
    const raw = headers[DEV_TENANT_HEADER];
    const tenantId = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;

    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      throw new UnauthorizedException('Authentication required.');
    }

    const normalized = tenantId.trim();

    if (!DEV_TENANT_IDS.includes(normalized)) {
      throw new UnauthorizedException('Authentication required.');
    }

    return Object.freeze({
      tenantId: normalized,
      permissions: Object.freeze([...(DEV_TENANT_PERMISSIONS[normalized] ?? [])]),
      requestId,
    });
  }

  private isProduction(): boolean {
    return process.env['NODE_ENV'] === 'production';
  }
}
