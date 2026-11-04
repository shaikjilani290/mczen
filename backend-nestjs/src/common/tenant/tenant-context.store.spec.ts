import {
  TenantContextStore,
  tenantContextStore,
  TenantContextMissingError,
  TenantContext,
  TenantActorType,
} from './tenant-context.store';

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: '019417a8-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
    actorType: 'user',
    permissions: ['conversations:read'],
    ...overrides,
  };
}

describe('TenantContextStore (Phase 6B foundation)', () => {
  it('runs contexts with AsyncLocalStorage across async boundaries', async () => {
    const store = new TenantContextStore();
    await store.run(ctx(), async () => {
      await Promise.resolve();
      expect(store.isActive()).toBe(true);
      expect(store.getOrThrow().actorType).toBe('user');
      expect(store.getOrThrow().tenantId).toMatch(/^[0-9a-f-]{36}$/);
    });
    expect(store.isActive()).toBe(false);
    expect(store.get()).toBeUndefined();
  });

  it('getOrThrow fails closed (throws TenantContextMissingError) outside run()', () => {
    const store = new TenantContextStore();
    expect(() => store.getOrThrow()).toThrow(TenantContextMissingError);
    // The error is a distinct, typed 500-class programming bug signal.
    let caught: unknown;
    try {
      store.getOrThrow();
    } catch (error) {
      caught = error;
    }
    expect((caught as TenantContextMissingError).name).toBe('TenantContextMissingError');
  });

  it('nested run() scopes are isolated (background-job nesting)', () => {
    const store = new TenantContextStore();
    store.run(ctx({ tenantId: 'outer-tenant' }), () => {
      expect(store.getOrThrow().tenantId).toBe('outer-tenant');
      store.run(ctx({ tenantId: 'inner-tenant', actorType: 'system' as TenantActorType }), () => {
        expect(store.getOrThrow().tenantId).toBe('inner-tenant');
      });
      // restored the outer scope afterwards
      expect(store.getOrThrow().tenantId).toBe('outer-tenant');
    });
    expect(store.isActive()).toBe(false);
  });

  it('actor types from the approved model are accepted verbatim', () => {
    const store = new TenantContextStore();
    for (const actorType of ['user', 'api_key', 'widget', 'system'] as const) {
      store.run(ctx({ actorType }), () => {
        expect(store.getOrThrow().actorType).toBe(actorType);
      });
    }
  });

  it('exports one process-wide store instance (one per gateway process)', () => {
    expect(tenantContextStore).toBeInstanceOf(TenantContextStore);
  });
});
