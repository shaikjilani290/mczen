"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantsService = void 0;
const common_1 = require("@nestjs/common");
const assistant_repository_1 = require("./assistant.repository");
const assistants_dto_1 = require("./assistants.dto");
const secret_cipher_service_1 = require("./secret-cipher.service");
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const nullable = (v) => (v === null || v === undefined ? null : String(v));
let AssistantsService = class AssistantsService {
    repo;
    cipher;
    constructor(repo, cipher) {
        this.repo = repo;
        this.cipher = cipher;
    }
    options() {
        return {
            languages: assistants_dto_1.LANGUAGES,
            sttProviders: assistants_dto_1.STT_PROVIDERS,
            ttsProviders: assistants_dto_1.TTS_PROVIDERS,
            voiceGenders: assistants_dto_1.VOICE_GENDERS,
            responseStyles: assistants_dto_1.RESPONSE_STYLES,
        };
    }
    async list() {
        const rows = await this.repo.list();
        return { assistants: rows.map((r) => ({ id: this.repo.toId(r.id), name: r.name, description: nullable(r.description), status: r.status, isDefault: r.is_default === 1, configVersion: Number(r.config_version), updatedAt: iso(r.updated_at) })) };
    }
    async get(id, manager) {
        const a = await this.repo.find(id, manager);
        const [voice, languages, instructions, secrets] = await Promise.all([
            this.repo.voice(id, manager), this.repo.languages(id, manager), this.repo.activeInstructions(id, manager), this.repo.configuredSecrets(id, manager),
        ]);
        const enabled = languages.filter((l) => l.is_enabled === 1).map((l) => l.language_code);
        const def = languages.find((l) => l.is_default === 1)?.language_code ?? 'en';
        return {
            id: this.repo.toId(a.id),
            isDefault: a.is_default === 1,
            configVersion: Number(a.config_version),
            createdAt: iso(a.created_at),
            updatedAt: iso(a.updated_at),
            profile: { name: a.name, description: nullable(a.description), personality: nullable(a.personality), greetingMessage: nullable(a.greeting_message), fallbackMessage: nullable(a.fallback_message), status: a.status },
            language: { mode: a.language_mode, defaultLanguage: def, enabled },
            voice: voice && {
                speechEnabled: voice.speech_enabled === 1, autoSpeak: voice.auto_speak === 1,
                sttProvider: voice.stt_provider, ttsProvider: voice.tts_provider, voiceGender: voice.voice_gender, voiceId: nullable(voice.voice_id),
                speechRate: Number(voice.speech_rate), speechPitch: Number(voice.speech_pitch),
            },
            secrets: { stt: { configured: secrets.includes('stt') }, tts: { configured: secrets.includes('tts') } },
            branding: { displayName: nullable(a.branding_display_name), primaryColor: nullable(a.branding_primary_color), logoUrl: nullable(a.branding_logo_url) },
            preferences: { responseStyle: a.response_style, showSources: a.show_sources === 1 },
            instructions: instructions && { version: Number(instructions.version), systemPrompt: instructions.system_prompt, guardrailNotes: nullable(instructions.guardrail_notes) },
        };
    }
    async create(input, actorId) {
        const id = await this.repo.transaction(async (manager) => {
            const max = await this.repo.maxAssistants(manager);
            const count = await this.repo.countActive(manager);
            if (count >= max)
                throw new common_1.ConflictException('Assistant limit reached for this tenant.');
            const newId = await this.repo.insertAssistant(manager, { name: input.name, description: input.description ?? null, isDefault: count === 0, actorId });
            if (input.systemPrompt)
                await this.repo.insertInstructions(manager, newId, input.systemPrompt, null, actorId);
            await this.repo.writeAudit(manager, newId, 'create', 1, ['profile.name'], actorId);
            return newId;
        });
        return this.get(id);
    }
    async update(id, input, actorId) {
        await this.repo.transaction(async (manager) => {
            const current = await this.repo.find(id, manager, true);
            const changed = [];
            const columns = {};
            const voiceColumns = {};
            const map = (section, source, target, names, convert = (v) => v) => {
                if (!source)
                    return;
                for (const [key, column] of Object.entries(names)) {
                    if (source[key] !== undefined) {
                        target[column] = convert(source[key]);
                        changed.push(`${section}.${key}`);
                    }
                }
            };
            const flag = (v) => (v ? 1 : 0);
            map('profile', input.profile, columns, { name: 'name', description: 'description', personality: 'personality', greetingMessage: 'greeting_message', fallbackMessage: 'fallback_message', status: 'status' });
            map('branding', input.branding, columns, { displayName: 'branding_display_name', primaryColor: 'branding_primary_color', logoUrl: 'branding_logo_url' });
            map('preferences', input.preferences, columns, { responseStyle: 'response_style' });
            map('preferences', input.preferences ? { showSources: input.preferences.showSources } : undefined, columns, { showSources: 'show_sources' }, flag);
            map('voice', input.voice, voiceColumns, { sttProvider: 'stt_provider', ttsProvider: 'tts_provider', voiceGender: 'voice_gender', voiceId: 'voice_id', speechRate: 'speech_rate', speechPitch: 'speech_pitch' });
            map('voice', input.voice ? { speechEnabled: input.voice.speechEnabled, autoSpeak: input.voice.autoSpeak } : undefined, voiceColumns, { speechEnabled: 'speech_enabled', autoSpeak: 'auto_speak' }, flag);
            if (input.language) {
                const rows = await this.repo.languages(id, manager);
                const enabled = input.language.enabled ?? rows.filter((r) => r.is_enabled === 1).map((r) => r.language_code);
                const def = input.language.defaultLanguage ?? (rows.find((r) => r.is_default === 1)?.language_code ?? 'en');
                if (!enabled.includes(def))
                    throw new common_1.ConflictException('The default language must be enabled.');
                if (input.language.mode) {
                    columns.language_mode = input.language.mode;
                    changed.push('language.mode');
                }
                if (input.language.enabled || input.language.defaultLanguage) {
                    await this.repo.replaceLanguages(manager, id, enabled, def);
                    if (input.language.enabled)
                        changed.push('language.enabled');
                    if (input.language.defaultLanguage)
                        changed.push('language.defaultLanguage');
                }
            }
            if (Object.keys(voiceColumns).length)
                await this.repo.updateVoiceColumns(manager, id, voiceColumns, actorId);
            if (Object.keys(columns).length)
                await this.repo.updateAssistantColumns(manager, id, columns);
            else
                await this.repo.bumpVersion(manager, id);
            const version = Number(current.config_version) + 1;
            await this.repo.writeAudit(manager, id, 'update', version, changed, actorId);
        });
        return this.get(id);
    }
    async setInstructions(id, input, actorId) {
        await this.repo.transaction(async (manager) => {
            const current = await this.repo.find(id, manager, true);
            await this.repo.insertInstructions(manager, id, input.systemPrompt, input.guardrailNotes ?? null, actorId);
            await this.repo.bumpVersion(manager, id);
            await this.repo.writeAudit(manager, id, 'instructions', Number(current.config_version) + 1, ['instructions'], actorId);
        });
        return this.get(id);
    }
    async instructionHistory(id) {
        await this.repo.find(id);
        const rows = await this.repo.instructionHistory(id);
        return {
            versions: rows.map((r) => ({
                version: Number(r.version), isActive: r.is_active === 1, systemPrompt: r.system_prompt, guardrailNotes: nullable(r.guardrail_notes),
                createdBy: r.created_by ? this.repo.toId(r.created_by) : null, createdAt: iso(r.created_at),
            })),
        };
    }
    async setSecret(id, kind, apiKey, actorId) {
        await this.repo.transaction(async (manager) => {
            const current = await this.repo.find(id, manager, true);
            const ciphertext = this.cipher.encrypt(apiKey, `${this.repo.tenantIdForAad()}:${id}:${kind}`);
            await this.repo.upsertSecret(manager, id, kind, ciphertext, actorId);
            await this.repo.writeAudit(manager, id, 'secret_set', Number(current.config_version), [`secret.${kind}`], actorId);
        });
        return { kind, configured: true };
    }
    async clearSecret(id, kind, actorId) {
        await this.repo.transaction(async (manager) => {
            const current = await this.repo.find(id, manager, true);
            await this.repo.deleteSecret(manager, id, kind);
            await this.repo.writeAudit(manager, id, 'secret_clear', Number(current.config_version), [`secret.${kind}`], actorId);
        });
        return { kind, configured: false };
    }
    async audit(id) {
        await this.repo.find(id);
        const rows = await this.repo.audit(id);
        return {
            entries: rows.map((r) => ({
                id: Number(r.id), action: r.action, configVersion: Number(r.config_version), changedFields: String(r.changed_fields).split(',').filter(Boolean),
                actorUserId: r.actor_user_id ? this.repo.toId(r.actor_user_id) : null, createdAt: iso(r.created_at),
            })),
        };
    }
};
exports.AssistantsService = AssistantsService;
exports.AssistantsService = AssistantsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [assistant_repository_1.AssistantRepository, secret_cipher_service_1.SecretCipher])
], AssistantsService);
//# sourceMappingURL=assistants.service.js.map