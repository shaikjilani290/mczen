"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Semaphore = exports.VoiceProviderError = void 0;
exports.readLoopbackUrl = readLoopbackUrl;
exports.fetchWithTimeout = fetchWithTimeout;
const common_1 = require("@nestjs/common");
class VoiceProviderError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
exports.VoiceProviderError = VoiceProviderError;
function readLoopbackUrl(name, defaultValue) {
    const raw = process.env[name] ?? defaultValue;
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new common_1.ServiceUnavailableException(`${name} must be a loopback HTTP URL.`);
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['127.0.0.1', '::1', 'localhost'].includes(host) ||
        !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new common_1.ServiceUnavailableException(`${name} must point to a loopback HTTP service.`);
    }
    return url;
}
async function fetchWithTimeout(input, init, timeoutMs) {
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
    }
    catch {
        if (parentSignal?.aborted || timedOut)
            throw new VoiceProviderError('VOICE_PROVIDER_TIMEOUT');
        throw new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE');
    }
    finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', onAbort);
    }
}
class Semaphore {
    maxActive;
    maxQueued;
    active = 0;
    waiters = [];
    constructor(maxActive, maxQueued) {
        this.maxActive = maxActive;
        this.maxQueued = maxQueued;
    }
    async run(operation) {
        const release = await this.acquire();
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
    acquire(signal) {
        if (signal?.aborted)
            return Promise.reject(new VoiceProviderError('VOICE_PROVIDER_TIMEOUT'));
        if (this.active < this.maxActive) {
            this.active++;
            return Promise.resolve(this.createRelease());
        }
        if (this.waiters.length >= this.maxQueued) {
            return Promise.reject(new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE'));
        }
        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject, signal };
            waiter.onAbort = () => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0)
                    this.waiters.splice(index, 1);
                reject(new VoiceProviderError('VOICE_PROVIDER_TIMEOUT'));
            };
            signal?.addEventListener('abort', waiter.onAbort, { once: true });
            this.waiters.push(waiter);
        });
    }
    createRelease() {
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            const waiter = this.waiters.shift();
            if (!waiter) {
                this.active--;
                return;
            }
            if (waiter.onAbort)
                waiter.signal?.removeEventListener('abort', waiter.onAbort);
            waiter.resolve(this.createRelease());
        };
    }
}
exports.Semaphore = Semaphore;
//# sourceMappingURL=voice-provider.util.js.map