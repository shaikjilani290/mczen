import { Repository, ObjectLiteral } from 'typeorm';
import { tenantContextStore, TenantContextMissingError } from './tenant-context.store';

/**
 * Base contract every tenant-owned repository extends (Phase 6A §7.3).
 *
 * Design intent (from the Phase 6A §7.4 secure/insecure examples):
 * - `tenantId` ALWAYS originates from the verified `TenantContextStore`, never
 *   from a caller-supplied value.
 * - The base class is fail-closed: operations without an established context
 *   throw `TenantContextMissingError` (a 500-class bug — never a 404).
 *
 * Phase 6B ships the base class and unit tests only; concrete tenant-owned
 * entity repositories arrive with their domains in 6C–6G.
 */
export abstract class TenantScopedRepository<Entity extends ObjectLiteral> {
  protected constructor(protected readonly repository: Repository<Entity>) {}

  /** Verified tenant id for the current execution flow (fail-closed). */
  protected currentTenantId(): string {
    const ctx = tenantContextStore.get();
    if (!ctx) {
      throw new TenantContextMissingError(
        'A tenant-scoped repository operation ran without an established tenant context.',
      );
    }
    return ctx.tenantId;
  }
}
