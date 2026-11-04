"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemorySharedState = void 0;
const shared_state_1 = require("./shared-state");
const MAX_ENTRIES = 50_000;
class MemorySharedState {
    now;
    maxEntries;
    driver = 'memory';
    values = new Map();
    counters = new Map();
    slots = new Map();
    constructor(now = Date.now, maxEntries = MAX_ENTRIES) {
        this.now = now;
        this.maxEntries = maxEntries;
    }
    async put(key, value, ttlMs) {
        this.ensureCapacity(this.values.has(key));
        this.values.set(key, { value, expiresAt: this.now() + ttlMs });
    }
    async get(key) { return this.read(key); }
    async take(key) {
        const value = this.read(key);
        this.values.delete(key);
        return value;
    }
    read(key) {
        const entry = this.values.get(key);
        if (!entry)
            return null;
        if (entry.expiresAt <= this.now()) {
            this.values.delete(key);
            return null;
        }
        return entry.value;
    }
    async del(key) { this.values.delete(key); }
    async hit(key, windowMs) {
        const now = this.now();
        const current = this.counters.get(key);
        if (current && current.resetAt > now)
            return ++current.count;
        this.ensureCapacity(current !== undefined);
        this.counters.set(key, { count: 1, resetAt: now + windowMs });
        return 1;
    }
    async acquireSlot(scope, member, limit, ttlMs) {
        const set = this.liveSlots(scope);
        if (!set.has(member) && set.size >= limit)
            return false;
        set.set(member, this.now() + ttlMs);
        this.slots.set(scope, set);
        return true;
    }
    async renewSlot(scope, member, ttlMs) {
        const set = this.liveSlots(scope);
        if (set.has(member))
            set.set(member, this.now() + ttlMs);
    }
    async releaseSlot(scope, member) {
        this.slots.get(scope)?.delete(member);
    }
    async countSlots(scope) { return this.liveSlots(scope).size; }
    async health() { return { ok: true, driver: 'memory', latencyMs: 0 }; }
    liveSlots(scope) {
        const set = this.slots.get(scope) ?? new Map();
        const now = this.now();
        for (const [member, expiresAt] of set)
            if (expiresAt <= now)
                set.delete(member);
        if (set.size === 0)
            this.slots.delete(scope);
        return set;
    }
    ensureCapacity(replacing) {
        if (replacing || this.values.size + this.counters.size < this.maxEntries)
            return;
        const now = this.now();
        for (const [key, entry] of this.values)
            if (entry.expiresAt <= now)
                this.values.delete(key);
        for (const [key, counter] of this.counters)
            if (counter.resetAt <= now)
                this.counters.delete(key);
        if (this.values.size + this.counters.size >= this.maxEntries)
            throw new shared_state_1.SharedStateUnavailableError('Shared state is at capacity.');
    }
}
exports.MemorySharedState = MemorySharedState;
//# sourceMappingURL=memory-shared-state.js.map