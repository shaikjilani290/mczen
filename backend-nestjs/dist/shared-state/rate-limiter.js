"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedRateLimiter = void 0;
exports.tooManyRequests = tooManyRequests;
const common_1 = require("@nestjs/common");
const shared_state_1 = require("./shared-state");
function tooManyRequests() {
    return new common_1.HttpException({ statusCode: 429, error: 'Too Many Requests', message: 'Too many requests.' }, 429);
}
class SharedRateLimiter {
    store;
    windowMs;
    constructor(store, windowMs = 60_000) {
        this.store = store;
        this.windowMs = windowMs;
    }
    async hit(key, limit) {
        let count;
        try {
            count = await this.store.hit(`rl:${key}`, this.windowMs);
        }
        catch (error) {
            if (error instanceof shared_state_1.SharedStateUnavailableError)
                throw new common_1.ServiceUnavailableException('Service is temporarily unavailable.');
            throw error;
        }
        if (count > limit)
            throw tooManyRequests();
    }
}
exports.SharedRateLimiter = SharedRateLimiter;
//# sourceMappingURL=rate-limiter.js.map