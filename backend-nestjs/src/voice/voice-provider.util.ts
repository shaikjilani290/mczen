import { ServiceUnavailableException } from '@nestjs/common';

export class VoiceProviderError extends Error {
  constructor(readonly code: 'VOICE_ENGINE_UNAVAILABLE' | 'VOICE_PROVIDER_TIMEOUT' | 'VOICE_PROVIDER_INVALID') {
    super(code);
  }
}

export function readLoopbackUrl(name: string, defaultValue: string): URL {
  const raw = process.env[name] ?? defaultValue;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceUnavailableException(`${name} must be a loopback HTTP URL.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ServiceUnavailableException(`${name} must point to a loopback HTTP service.`);
  }
  return url;
}

export async function fetchWithTimeout(
  input: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const parentSignal = init.signal;
  const onAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch {
    if (parentSignal?.aborted || timedOut) throw new VoiceProviderError('VOICE_PROVIDER_TIMEOUT');
    throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (error: VoiceProviderError) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  constructor(private readonly maxActive: number, private readonly maxQueued: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new VoiceProviderError('VOICE_PROVIDER_TIMEOUT'));
    if (this.active < this.maxActive) {
      this.active++;
      return Promise.resolve(this.createRelease());
    }
    if (this.waiters.length >= this.maxQueued) {
      return Promise.reject(new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE'));
    }
    return new Promise((resolve, reject) => {
      const waiter: (typeof this.waiters)[number] = { resolve, reject, signal };
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new VoiceProviderError('VOICE_PROVIDER_TIMEOUT'));
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.waiters.shift();
      if (!waiter) {
        this.active--;
        return;
      }
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.resolve(this.createRelease());
    };
  }
}
