/** DI token for the process-shared coordination store (tickets, rate limits, concurrency slots). */
export const SHARED_STATE = Symbol('SHARED_STATE');

export interface SharedStateHealth {
  ok: boolean;
  driver: 'memory' | 'redis';
  latencyMs?: number;
}

/**
 * Minimal coordination primitives used by McZEN. Values are short-lived metadata only:
 * never audio, never bearer tokens, never provider secrets.
 *
 * Contract (identical for every driver):
 * - `take` is atomic: of N concurrent callers exactly one receives the value.
 * - Every record has a TTL; expired records behave as absent.
 * - `hit` is a fixed-window counter: the first hit opens a window of `windowMs`.
 * - Slots are a bounded set per scope whose members expire unless renewed.
 */
export interface SharedState {
  readonly driver: 'memory' | 'redis';
  put(key: string, value: string, ttlMs: number): Promise<void>;
  get(key: string): Promise<string | null>;
  take(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  hit(key: string, windowMs: number): Promise<number>;
  acquireSlot(scope: string, member: string, limit: number, ttlMs: number): Promise<boolean>;
  renewSlot(scope: string, member: string, ttlMs: number): Promise<void>;
  releaseSlot(scope: string, member: string): Promise<void>;
  countSlots(scope: string): Promise<number>;
  health(): Promise<SharedStateHealth>;
}

/** Raised when the shared store cannot answer. Callers must fail closed, never fall back to local state. */
export class SharedStateUnavailableError extends Error {
  constructor(message = 'Shared state is unavailable.') {
    super(message);
    this.name = 'SharedStateUnavailableError';
  }
}

export class SharedStateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedStateConfigError';
  }
}
