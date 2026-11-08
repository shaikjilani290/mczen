"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIDGET_BUTTON_STYLES = exports.WIDGET_POSITIONS = exports.WIDGET_THEMES = exports.WIDGET_LANGUAGES = void 0;
exports.normalizeOrigin = normalizeOrigin;
exports.parseWidgetSettingsUpdate = parseWidgetSettingsUpdate;
exports.isPublicKey = isPublicKey;
exports.parsePublicSession = parsePublicSession;
exports.parsePublicMessage = parsePublicMessage;
exports.parseDateRange = parseDateRange;
exports.parseTenantStatus = parseTenantStatus;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
exports.WIDGET_LANGUAGES = ['en', 'hi', 'te'];
exports.WIDGET_THEMES = ['light', 'dark', 'auto'];
exports.WIDGET_POSITIONS = ['bottom-right', 'bottom-left'];
exports.WIDGET_BUTTON_STYLES = ['round', 'pill', 'square'];
const MAX_ORIGINS = 20;
const PUBLIC_KEY = /^wk_[A-Za-z0-9_-]{32,60}$/;
function record(body, allowed) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new common_1.BadRequestException('A JSON object is required.');
    const input = body;
    if (Object.keys(input).some((key) => !allowed.includes(key)))
        throw new common_1.BadRequestException('The request contains unsupported fields.');
    return input;
}
function text(value, field, min, max) {
    if (typeof value !== 'string')
        throw new common_1.BadRequestException(`${field} is invalid.`);
    const trimmed = value.trim();
    if (trimmed.length < min || trimmed.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
        throw new common_1.BadRequestException(`${field} is invalid.`);
    }
    return trimmed;
}
function oneOf(value, values, field) {
    if (typeof value !== 'string' || !values.includes(value))
        throw new common_1.BadRequestException(`${field} is invalid.`);
    return value;
}
function normalizeOrigin(value, production = process.env.NODE_ENV === 'production') {
    if (typeof value !== 'string' || value.length > 253)
        throw new common_1.BadRequestException('An allowed origin is invalid.');
    let url;
    try {
        url = new URL(value.trim());
    }
    catch {
        throw new common_1.BadRequestException('An allowed origin is invalid.');
    }
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && loopback && !production);
    if (!schemeOk || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) {
        throw new common_1.BadRequestException('Allowed origins must be exact HTTPS origins without paths or wildcards.');
    }
    return url.origin;
}
function parseWidgetSettingsUpdate(body) {
    const input = record(body, ['enabled', 'assistantId', 'name', 'logoUrl', 'primaryColor', 'theme', 'position', 'buttonStyle',
        'welcomeMessage', 'initialGreeting', 'allowedOrigins']);
    const out = {};
    if (input.enabled !== undefined) {
        if (typeof input.enabled !== 'boolean')
            throw new common_1.BadRequestException('enabled is invalid.');
        out.enabled = input.enabled;
    }
    if (input.assistantId !== undefined) {
        if (input.assistantId !== null && (typeof input.assistantId !== 'string' || !(0, uuid_1.isUuidv7)(input.assistantId)))
            throw new common_1.BadRequestException('assistantId is invalid.');
        out.assistantId = input.assistantId;
    }
    if (input.name !== undefined)
        out.name = text(input.name, 'name', 1, 100);
    if (input.logoUrl !== undefined) {
        if (input.logoUrl === null || input.logoUrl === '')
            out.logoUrl = null;
        else {
            const raw = text(input.logoUrl, 'logoUrl', 1, 500);
            let url;
            try {
                url = new URL(raw);
            }
            catch {
                throw new common_1.BadRequestException('logoUrl is invalid.');
            }
            if (url.protocol !== 'https:' || url.username || url.password)
                throw new common_1.BadRequestException('logoUrl must be an HTTPS URL.');
            out.logoUrl = url.toString();
        }
    }
    if (input.primaryColor !== undefined) {
        if (typeof input.primaryColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.primaryColor))
            throw new common_1.BadRequestException('primaryColor must be #RRGGBB.');
        out.primaryColor = input.primaryColor.toLowerCase();
    }
    if (input.theme !== undefined)
        out.theme = oneOf(input.theme, exports.WIDGET_THEMES, 'theme');
    if (input.position !== undefined)
        out.position = oneOf(input.position, exports.WIDGET_POSITIONS, 'position');
    if (input.buttonStyle !== undefined)
        out.buttonStyle = oneOf(input.buttonStyle, exports.WIDGET_BUTTON_STYLES, 'buttonStyle');
    if (input.welcomeMessage !== undefined)
        out.welcomeMessage = input.welcomeMessage === null ? null : text(input.welcomeMessage, 'welcomeMessage', 0, 300) || null;
    if (input.initialGreeting !== undefined)
        out.initialGreeting = input.initialGreeting === null ? null : text(input.initialGreeting, 'initialGreeting', 0, 1000) || null;
    if (input.allowedOrigins !== undefined) {
        if (!Array.isArray(input.allowedOrigins) || input.allowedOrigins.length > MAX_ORIGINS)
            throw new common_1.BadRequestException('allowedOrigins is invalid.');
        out.allowedOrigins = [...new Set(input.allowedOrigins.map((origin) => normalizeOrigin(origin)))];
    }
    if (Object.keys(out).length === 0)
        throw new common_1.BadRequestException('No changes were supplied.');
    return out;
}
function isPublicKey(value) {
    return typeof value === 'string' && PUBLIC_KEY.test(value);
}
function parsePublicSession(body) {
    const input = record(body, ['publicKey', 'assistantId', 'language']);
    const publicKey = input.publicKey;
    const widgetKey = isPublicKey(publicKey);
    const integrationKey = typeof publicKey === 'string' && /^mzp_[A-Za-z0-9_-]{43}$/.test(publicKey);
    if (!widgetKey && !integrationKey)
        throw new common_1.BadRequestException('The widget key is invalid.');
    if (input.assistantId !== undefined && (typeof input.assistantId !== 'string' || !(0, uuid_1.isUuidv7)(input.assistantId))) {
        throw new common_1.BadRequestException('assistantId is invalid.');
    }
    if (input.assistantId !== undefined && !integrationKey)
        throw new common_1.BadRequestException('assistantId is only valid for a website integration.');
    return {
        publicKey: publicKey,
        ...(input.assistantId ? { assistantId: input.assistantId } : {}),
        ...(input.language !== undefined ? { language: oneOf(input.language, exports.WIDGET_LANGUAGES, 'language') } : {}),
    };
}
function parsePublicMessage(body) {
    const input = record(body, ['message', 'language', 'requestId']);
    if (input.requestId !== undefined && (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,128}$/.test(input.requestId))) {
        throw new common_1.BadRequestException('requestId is invalid.');
    }
    return {
        message: text(input.message, 'message', 1, 2000),
        ...(input.language !== undefined ? { language: oneOf(input.language, exports.WIDGET_LANGUAGES, 'language') } : {}),
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    };
}
function parseDateRange(query, now = new Date()) {
    const day = (value, field) => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
            throw new common_1.BadRequestException(`${field} must be YYYY-MM-DD.`);
        const date = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
            throw new common_1.BadRequestException(`${field} is invalid.`);
        return date;
    };
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const to = query.to === undefined ? today : day(query.to, 'to');
    const from = query.from === undefined ? new Date(to.getTime() - 29 * 86_400_000) : day(query.from, 'from');
    if (from > to)
        throw new common_1.BadRequestException('from must not be after to.');
    if ((to.getTime() - from.getTime()) / 86_400_000 > 365)
        throw new common_1.BadRequestException('The date range is limited to 366 days.');
    return { from, to: new Date(to.getTime() + 86_400_000) };
}
function parseTenantStatus(body) {
    const input = record(body, ['status', 'reason']);
    return {
        status: oneOf(input.status, ['active', 'suspended'], 'status'),
        reason: input.reason === undefined || input.reason === null ? null : text(input.reason, 'reason', 1, 255),
    };
}
//# sourceMappingURL=widget.dto.js.map