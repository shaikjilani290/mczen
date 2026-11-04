"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedStateConfigError = exports.SharedStateUnavailableError = exports.SHARED_STATE = void 0;
exports.SHARED_STATE = Symbol('SHARED_STATE');
class SharedStateUnavailableError extends Error {
    constructor(message = 'Shared state is unavailable.') {
        super(message);
        this.name = 'SharedStateUnavailableError';
    }
}
exports.SharedStateUnavailableError = SharedStateUnavailableError;
class SharedStateConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SharedStateConfigError';
    }
}
exports.SharedStateConfigError = SharedStateConfigError;
//# sourceMappingURL=shared-state.js.map