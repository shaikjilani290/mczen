import { AsyncLocalStorage } from 'node:async_hooks';

/** Actor classes that may establish a tenant context (Phase 6A §7.2). */
export type TenantActorType = 'user' | 'api_key' | 'widget' | 'system';

/**
 * Tenant context established ONLY by the verified authentication pipeline
 * (Phase 6A §7.2). A context never originates from request headers, URL
 * segments, body fields, or AI-generated tool arguments.
 */
export interface TenantContext {
  readonly tenantId: string;
  readonly actorType: TenantActorType;
  readonly userId?: string;
  /** Set only after the backend verifies the selected assistant belongs to the tenant. */
  readonly assistantId?: string;
  /** `resource:action` strings resolved from the active tenant's role. */
  readonly permissions: readonly string[];
  readonly requestId?: string;
}

/** Thrown when code touching tenant data runs without an established context. */
export class TenantContextMissingError extends Error {
  constructor(message = 'Tenant context is not established for this operation.') {
    super(message);
    this.name = 'TenantContextMissingError';
  }
}

/**
 * Request-scoped tenant context store (Phase 6A §7.2 guard pipeline).
 *
 * The guard writes the verified context after authorization; repositories and
 * services read it here instead of trusting request-carried values. Nested
 * `run(...)` scopes (e.g. background jobs) are supported and isolated.
 */
export class TenantContextStore {
  readonly als: AsyncLocalStorage<TenantContext> = new AsyncLocalStorage();

  /** Establishes the context for the duration of `fn` (sync or async); nestable. */
  run<T>(context: TenantContext, fn: () => T): T {
    return this.als.run(context, fn);
  }

  /** Fail-closed accessor used by repositories and services (Phase 6A §7.3). */
  get(): TenantContext | undefined {
    return this.als.getStore();
  }

  getOrThrow(): TenantContext {
    const ctx = this.als.getStore();
    if (!ctx) {
      throw new TenantContextMissingError();
    }
    return ctx;
  }

  /** True when a context exists for the current execution flow. */
  isActive(): boolean {
    return this.als.getStore() !== undefined;
  }
}

/** Process-wide store instance (one per gateway process, as designed in 6A §7.2). */
export const tenantContextStore = new TenantContextStore();
