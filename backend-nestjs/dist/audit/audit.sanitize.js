"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeMetadata = sanitizeMetadata;
const MAX_KEYS = 20;
const MAX_STRING = 200;
const FORBIDDEN_KEY = /pass|secret|token|key|cipher|authorization|cookie|audio|value|credential|email|phone|ticket|hash/i;
const SECRET_VALUE = /(^|\s)(bearer\s+\S+|(mzt|wk|sk)_[A-Za-z0-9_-]{8,})|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i;
function sanitizeMetadata(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return null;
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (Object.keys(output).length >= MAX_KEYS)
            break;
        if (key.length > 40 || FORBIDDEN_KEY.test(key))
            continue;
        if (value === null || typeof value === 'boolean')
            output[key] = value;
        else if (typeof value === 'number') {
            if (Number.isFinite(value))
                output[key] = value;
        }
        else if (typeof value === 'string') {
            if (SECRET_VALUE.test(value))
                continue;
            output[key] = value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
        }
    }
    return Object.keys(output).length > 0 ? output : null;
}
//# sourceMappingURL=audit.sanitize.js.map