"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTenantToolUpdate = parseTenantToolUpdate;
exports.parseAssistantToolUpdate = parseAssistantToolUpdate;
exports.parseToolSecret = parseToolSecret;
exports.validateToolReference = validateToolReference;
const common_1 = require("@nestjs/common");
function object(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new common_1.BadRequestException('A JSON object is required.');
    }
    const record = value;
    if (Object.keys(record).some((key) => !allowed.includes(key))) {
        throw new common_1.BadRequestException('The request contains an unsupported field.');
    }
    return record;
}
function parseTenantToolUpdate(value) {
    const raw = object(value, ['enabled', 'extraPermissions', 'config']);
    const result = {};
    if ('enabled' in raw) {
        if (typeof raw.enabled !== 'boolean')
            throw new common_1.BadRequestException('enabled must be a boolean.');
        result.enabled = raw.enabled;
    }
    if ('extraPermissions' in raw) {
        if (!Array.isArray(raw.extraPermissions) || raw.extraPermissions.length > 20 ||
            raw.extraPermissions.some((p) => typeof p !== 'string' || !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(p))) {
            throw new common_1.BadRequestException('extraPermissions must contain valid permission keys.');
        }
        result.extraPermissions = [...new Set(raw.extraPermissions)];
    }
    if ('config' in raw) {
        if (!raw.config || typeof raw.config !== 'object' || Array.isArray(raw.config)) {
            throw new common_1.BadRequestException('config must be a JSON object.');
        }
        result.config = raw.config;
    }
    if (!Object.keys(result).length)
        throw new common_1.BadRequestException('At least one setting is required.');
    return result;
}
function parseAssistantToolUpdate(value) {
    const raw = object(value, ['enabled']);
    if (typeof raw.enabled !== 'boolean')
        throw new common_1.BadRequestException('enabled must be a boolean.');
    return raw.enabled;
}
function parseToolSecret(value) {
    const raw = object(value, ['value', 'expiresAt']);
    if (typeof raw.value !== 'string' || raw.value.length < 1 || raw.value.length > 1024) {
        throw new common_1.BadRequestException('Secret value must contain between 1 and 1024 characters.');
    }
    let expiresAt = null;
    if (raw.expiresAt !== undefined && raw.expiresAt !== null) {
        if (typeof raw.expiresAt !== 'string' || !Number.isFinite(Date.parse(raw.expiresAt))) {
            throw new common_1.BadRequestException('expiresAt must be a valid ISO date or null.');
        }
        expiresAt = new Date(raw.expiresAt).toISOString();
        if (Date.parse(expiresAt) <= Date.now())
            throw new common_1.BadRequestException('expiresAt must be in the future.');
    }
    return { value: raw.value, expiresAt };
}
function validateToolReference(value) {
    if (!(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) || /^[1-9]\d{0,19}$/.test(value))) {
        throw new common_1.BadRequestException('Tool not found.');
    }
    return value;
}
//# sourceMappingURL=tools.dto.js.map