import { SharedStateUnavailableError, type SharedState, type SharedStateHealth } from './shared-state';

interface Entry { value: string; expiresAt: number }
interface Counter { count: number; resetAt: number }

const MAX_ENTRIES = 50_000;

/**
 * Process-local implementation for development and automated tests only.
 * It is NOT shared between backend instances; production must use the Redis driver
 * (or explicitly acknowledge a single instance, see shared-state.config).
 */
export class MemorySharedState implements SharedState {
  readonly driver = 'memory' as const;
  private readonly values = new Map<string, Entry>();
  private readonly counters = new Map<string, Counter>();
  private readonly slots = new Map<string, Map<string, number>>();

  constructor(private readonly now: () => number = Date.now, private readonly maxEntries = MAX_ENTRIES) {}

  async put(key: string, value: string, ttlMs: number): Promise<void> {
    this.ensureCapacity(this.values.has(key));
    this.values.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  async get(key: string): Promise<string | null> { return this.read(key); }

  async take(key: string): Promise<string | null> {
    // Synchronous read+delete: no await between them, so concurrent callers cannot both succeed.
    const value = this.read(key);
    this.values.delete(key);
    return value;
  }

  private read(key: string): string | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) { this.values.delete(key); return null; }
    return entry.value;
  }

  async del(key: string): Promise<void> { this.values.delete(key); }

  async hit(key: string, windowMs: number): Promise<number> {
    const now = this.now();
    const current = this.counters.get(key);
    if (current && current.resetAt > now) return ++current.count;
    this.ensureCapacity(current !== undefined);
    this.counters.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }

  async acquireSlot(scope: string, member: string, limit: number, ttlMs: number): Promise<boolean> {
    const set = this.liveSlots(scope);
    if (!set.has(member) && set.size >= limit) return false;
    set.set(member, this.now() + ttlMs);
    this.slots.set(scope, set);
    return true;
  }

  async renewSlot(scope: string, member: string, ttlMs: number): Promise<void> {
    const set = this.liveSlots(scope);
    if (set.has(member)) set.set(member, this.now() + ttlMs);
  }

  async releaseSlot(scope: string, member: string): Promise<void> {
    this.slots.get(scope)?.delete(member);
  }

  async countSlots(scope: string): Promise<number> { return this.liveSlots(scope).size; }

  async health(): Promise<SharedStateHealth> { return { ok: true, driver: 'memory', latencyMs: 0 }; }

  private liveSlots(scope: string): Map<string, number> {
    const set = this.slots.get(scope) ?? new Map<string, number>();
    const now = this.now();
    for (const [member, expiresAt] of set) if (expiresAt <= now) set.delete(member);
    if (set.size === 0) this.slots.delete(scope);
    return set;
  }

  private ensureCapacity(replacing: boolean): void {
    if (replacing || this.values.size + this.counters.size < this.maxEntries) return;
    const now = this.now();
    for (const [key, entry] of this.values) if (entry.expiresAt <= now) this.values.delete(key);
    for (const [key, counter] of this.counters) if (counter.resetAt <= now) this.counters.delete(key);
    if (this.values.size + this.counters.size >= this.maxEntries) throw new SharedStateUnavailableError('Shared state is at capacity.');
  }
}
