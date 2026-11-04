"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bodyObject = bodyObject;
exports.normalizeEmail = normalizeEmail;
exports.validatePassword = validatePassword;
exports.parseRegisterInput = parseRegisterInput;
exports.parseLoginInput = parseLoginInput;
exports.parseLogoutInput = parseLogoutInput;
const common_1 = require("@nestjs/common");
const token_service_1 = require("./token.service");
function bodyObject(body, allowed) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.getPrototypeOf(body) !== Object.prototype || Object.keys(body).some((key) => !allowed.includes(key))) {
        throw new common_1.BadRequestException('Invalid request body.');
    }
    return body;
}
function normalizeEmail(value) {
    if (typeof value !== 'string' || value.length > 255)
        return undefined;
    const email = value.trim().toLowerCase();
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email) ? email : undefined;
}
function validatePassword(value) {
    if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
        throw new common_1.BadRequestException('The password must be 12 to 128 characters long.');
    }
}
function parseRegisterInput(body) {
    const input = bodyObject(body, ['email', 'password', 'name', 'tenantName', 'tenantSlug', 'inviteToken', 'invite_token']);
    const email = normalizeEmail(input.email);
    if (!email)
        throw new common_1.BadRequestException('A valid email address is required.');
    validatePassword(input.password);
    if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 150)) {
        throw new common_1.BadRequestException('Name must be at most 150 characters.');
    }
    if (input.inviteToken !== undefined && input.invite_token !== undefined)
        throw new common_1.BadRequestException('Provide only one invite token field.');
    const inviteToken = input.inviteToken ?? input.invite_token;
    const dto = { email, password: input.password, name: input.name };
    if (inviteToken !== undefined) {
        if (!(0, token_service_1.isOpaqueToken)(inviteToken, 'mzp_') || input.tenantName !== undefined || input.tenantSlug !== undefined) {
            throw new common_1.BadRequestException('Invalid invite registration.');
        }
        return { ...dto, inviteToken };
    }
    if (typeof input.tenantName !== 'string' || !input.tenantName.trim() || input.tenantName.length > 150 ||
        typeof input.tenantSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(input.tenantSlug)) {
        throw new common_1.BadRequestException('Provide a workspace name (1–150 characters) and identifier (2–63 lowercase letters, digits or hyphens).');
    }
    return { ...dto, tenantName: input.tenantName.trim(), tenantSlug: input.tenantSlug };
}
function parseLoginInput(body) {
    const input = bodyObject(body, ['email', 'password']);
    const email = normalizeEmail(input.email);
    if (!email || typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 128) {
        throw new common_1.UnauthorizedException('Invalid email or password.');
    }
    return { email, password: input.password };
}
function parseLogoutInput(body) {
    const input = bodyObject(body ?? {}, ['refreshToken', 'allSessions']);
    if ((input.refreshToken !== undefined && !(0, token_service_1.isOpaqueToken)(input.refreshToken, 'mzr_')) ||
        (input.allSessions !== undefined && typeof input.allSessions !== 'boolean')) {
        throw new common_1.BadRequestException('Invalid logout request.');
    }
    return input;
}
//# sourceMappingURL=auth.dto.js.map