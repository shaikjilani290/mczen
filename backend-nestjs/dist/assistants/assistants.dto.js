"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SYSTEM_PROMPT = exports.SECRET_KINDS = exports.STATUSES = exports.RESPONSE_STYLES = exports.VOICE_GENDERS = exports.TTS_PROVIDERS = exports.STT_PROVIDERS = exports.LANGUAGES = void 0;
exports.parseCreateAssistant = parseCreateAssistant;
exports.parseUpdateAssistant = parseUpdateAssistant;
exports.parseInstructions = parseInstructions;
exports.parseSecretKind = parseSecretKind;
exports.parseSecretInput = parseSecretInput;
const common_1 = require("@nestjs/common");
const auth_dto_1 = require("../auth/auth.dto");
exports.LANGUAGES = ['en', 'hi', 'te'];
exports.STT_PROVIDERS = ['browser', 'faster-whisper', 'whisper-api', 'google'];
exports.TTS_PROVIDERS = ['browser', 'piper', 'elevenlabs', 'google'];
exports.VOICE_GENDERS = ['female', 'male', 'neutral'];
exports.RESPONSE_STYLES = ['concise', 'balanced', 'detailed'];
exports.STATUSES = ['draft', 'active', 'paused', 'archived'];
exports.SECRET_KINDS = ['stt', 'tts'];
exports.MAX_SYSTEM_PROMPT = 16000;
const invalid = () => {
    throw new common_1.BadRequestException('Invalid request body.');
};
function text(v, max, opts = {}) {
    if (v === null && opts.nullable)
        return null;
    if (typeof v !== 'string')
        return invalid();
    const s = v.trim();
    if (s.length < (opts.min ?? 0) || s.length > max)
        return invalid();
    if (s === '' && opts.nullable)
        return null;
    return s;
}
function oneOf(v, allowed) {
    return typeof v === 'string' && allowed.includes(v) ? v : invalid();
}
function bool(v) {
    return typeof v === 'boolean' ? v : invalid();
}
function range(v, min, max) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
        return invalid();
    return Math.round(v * 100) / 100;
}
function httpsUrl(v) {
    const s = text(v, 500, { nullable: true });
    if (s === null)
        return null;
    try {
        const u = new URL(s);
        if (u.protocol !== 'https:' || u.username || u.password)
            return invalid();
    }
    catch {
        return invalid();
    }
    return s;
}
function parseCreateAssistant(body) {
    const b = (0, auth_dto_1.bodyObject)(body, ['name', 'description', 'systemPrompt']);
    const out = { name: text(b.name, 100, { min: 1 }) };
    if ('description' in b)
        out.description = text(b.description, 500, { nullable: true });
    if ('systemPrompt' in b)
        out.systemPrompt = text(b.systemPrompt, exports.MAX_SYSTEM_PROMPT, { min: 1 });
    return out;
}
function parseUpdateAssistant(body) {
    const b = (0, auth_dto_1.bodyObject)(body, ['profile', 'language', 'voice', 'branding', 'preferences']);
    const out = {};
    if (b.profile !== undefined) {
        const p = (0, auth_dto_1.bodyObject)(b.profile, ['name', 'description', 'personality', 'greetingMessage', 'fallbackMessage', 'status']);
        const r = {};
        if ('name' in p)
            r.name = text(p.name, 100, { min: 1 });
        if ('description' in p)
            r.description = text(p.description, 500, { nullable: true });
        if ('personality' in p)
            r.personality = text(p.personality, 1000, { nullable: true });
        if ('greetingMessage' in p)
            r.greetingMessage = text(p.greetingMessage, 1000, { nullable: true });
        if ('fallbackMessage' in p)
            r.fallbackMessage = text(p.fallbackMessage, 1000, { nullable: true });
        if ('status' in p)
            r.status = oneOf(p.status, exports.STATUSES);
        out.profile = r;
    }
    if (b.language !== undefined) {
        const l = (0, auth_dto_1.bodyObject)(b.language, ['mode', 'defaultLanguage', 'enabled']);
        const r = {};
        if ('mode' in l)
            r.mode = oneOf(l.mode, ['auto', 'manual']);
        if ('defaultLanguage' in l)
            r.defaultLanguage = oneOf(l.defaultLanguage, exports.LANGUAGES);
        if ('enabled' in l) {
            if (!Array.isArray(l.enabled) || l.enabled.length < 1 || l.enabled.length > exports.LANGUAGES.length)
                invalid();
            const list = l.enabled.map((x) => oneOf(x, exports.LANGUAGES));
            if (new Set(list).size !== list.length)
                invalid();
            r.enabled = list;
        }
        out.language = r;
    }
    if (b.voice !== undefined) {
        const v = (0, auth_dto_1.bodyObject)(b.voice, ['speechEnabled', 'autoSpeak', 'sttProvider', 'ttsProvider', 'voiceGender', 'voiceId', 'speechRate', 'speechPitch']);
        const r = {};
        if ('speechEnabled' in v)
            r.speechEnabled = bool(v.speechEnabled);
        if ('autoSpeak' in v)
            r.autoSpeak = bool(v.autoSpeak);
        if ('sttProvider' in v)
            r.sttProvider = oneOf(v.sttProvider, exports.STT_PROVIDERS);
        if ('ttsProvider' in v)
            r.ttsProvider = oneOf(v.ttsProvider, exports.TTS_PROVIDERS);
        if ('voiceGender' in v)
            r.voiceGender = oneOf(v.voiceGender, exports.VOICE_GENDERS);
        if ('voiceId' in v) {
            r.voiceId = text(v.voiceId, 150, { nullable: true });
            if (r.voiceId !== null && !/^[A-Za-z0-9._:\- ]+$/.test(r.voiceId))
                invalid();
        }
        if ('speechRate' in v)
            r.speechRate = range(v.speechRate, 0.5, 2);
        if ('speechPitch' in v)
            r.speechPitch = range(v.speechPitch, 0, 2);
        out.voice = r;
    }
    if (b.branding !== undefined) {
        const br = (0, auth_dto_1.bodyObject)(b.branding, ['displayName', 'primaryColor', 'logoUrl']);
        const r = {};
        if ('displayName' in br)
            r.displayName = text(br.displayName, 100, { nullable: true });
        if ('primaryColor' in br) {
            r.primaryColor = text(br.primaryColor, 7, { nullable: true });
            if (r.primaryColor !== null && !/^#[0-9a-fA-F]{6}$/.test(r.primaryColor))
                invalid();
        }
        if ('logoUrl' in br)
            r.logoUrl = httpsUrl(br.logoUrl);
        out.branding = r;
    }
    if (b.preferences !== undefined) {
        const pr = (0, auth_dto_1.bodyObject)(b.preferences, ['responseStyle', 'showSources']);
        const r = {};
        if ('responseStyle' in pr)
            r.responseStyle = oneOf(pr.responseStyle, exports.RESPONSE_STYLES);
        if ('showSources' in pr)
            r.showSources = bool(pr.showSources);
        out.preferences = r;
    }
    if (Object.keys(out).length === 0)
        invalid();
    const lang = out.language;
    if (lang?.enabled && lang.defaultLanguage && !lang.enabled.includes(lang.defaultLanguage))
        invalid();
    return out;
}
function parseInstructions(body) {
    const b = (0, auth_dto_1.bodyObject)(body, ['systemPrompt', 'guardrailNotes']);
    const out = { systemPrompt: text(b.systemPrompt, exports.MAX_SYSTEM_PROMPT, { min: 1 }) };
    if ('guardrailNotes' in b)
        out.guardrailNotes = text(b.guardrailNotes, 2000, { nullable: true });
    return out;
}
function parseSecretKind(value) {
    return oneOf(value, exports.SECRET_KINDS);
}
function parseSecretInput(body) {
    const b = (0, auth_dto_1.bodyObject)(body, ['apiKey']);
    const key = text(b.apiKey, 512, { min: 8 });
    if (/[\u0000-\u001f\u007f]/.test(key))
        invalid();
    return key;
}
//# sourceMappingURL=assistants.dto.js.map