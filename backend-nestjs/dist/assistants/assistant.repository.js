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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantRepository = exports.DEFAULT_MAX_ASSISTANTS = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const uuid_1 = require("../common/ids/uuid");
const tenant_scoped_repository_1 = require("../common/tenant/tenant-scoped.repository");
exports.DEFAULT_MAX_ASSISTANTS = 3;
const ALL_LANGUAGES = ['en', 'hi', 'te'];
let AssistantRepository = class AssistantRepository extends tenant_scoped_repository_1.TenantScopedRepository {
    source;
    constructor(source) {
        super(undefined);
        this.source = source;
    }
    get database() {
        if (!this.source)
            throw new common_1.ServiceUnavailableException('Assistant configuration is unavailable.');
        return this.source;
    }
    transaction(work) {
        return this.database.transaction(work);
    }
    tenantBinary() {
        return (0, uuid_1.uuidToBinary)(this.currentTenantId());
    }
    run(manager, sql, params) {
        return (manager ?? this.database).query(sql, params);
    }
    assistantBinary(id) {
        if (!(0, uuid_1.isUuidv7)(id))
            throw new common_1.NotFoundException('Assistant not found.');
        return (0, uuid_1.uuidToBinary)(id);
    }
    async list() {
        return this.run(undefined, 'SELECT * FROM `assistants` WHERE `tenant_id` = ? AND `deleted_at` IS NULL ORDER BY `created_at`, `id`', [this.tenantBinary()]);
    }
    async find(id, manager, lock = false) {
        const rows = await this.run(manager, `SELECT * FROM \`assistants\` WHERE \`id\` = ? AND \`tenant_id\` = ? AND \`deleted_at\` IS NULL${lock ? ' FOR UPDATE' : ''}`, [this.assistantBinary(id), this.tenantBinary()]);
        if (!rows[0])
            throw new common_1.NotFoundException('Assistant not found.');
        return rows[0];
    }
    async voice(id, manager) {
        return (await this.run(manager, 'SELECT * FROM `assistant_voice_settings` WHERE `assistant_id` = ? AND `tenant_id` = ?', [this.assistantBinary(id), this.tenantBinary()]))[0];
    }
    async languages(id, manager) {
        return this.run(manager, 'SELECT `language_code`, `is_enabled`, `is_default` FROM `assistant_language_settings` WHERE `assistant_id` = ? AND `tenant_id` = ? ORDER BY `language_code`', [this.assistantBinary(id), this.tenantBinary()]);
    }
    async activeInstructions(id, manager) {
        return (await this.run(manager, 'SELECT `version`, `system_prompt`, `guardrail_notes`, `created_at` FROM `assistant_instructions` WHERE `assistant_id` = ? AND `tenant_id` = ? AND `is_active` = 1', [this.assistantBinary(id), this.tenantBinary()]))[0];
    }
    async instructionHistory(id) {
        return this.run(undefined, 'SELECT `version`, `system_prompt`, `guardrail_notes`, `is_active`, `created_by`, `created_at` FROM `assistant_instructions` WHERE `assistant_id` = ? AND `tenant_id` = ? ORDER BY `version` DESC LIMIT 100', [this.assistantBinary(id), this.tenantBinary()]);
    }
    async configuredSecrets(id, manager) {
        const rows = await this.run(manager, 'SELECT `kind` FROM `assistant_provider_secrets` WHERE `assistant_id` = ? AND `tenant_id` = ?', [this.assistantBinary(id), this.tenantBinary()]);
        return rows.map((r) => r.kind);
    }
    async audit(id) {
        return this.run(undefined, 'SELECT `id`, `actor_user_id`, `action`, `config_version`, `changed_fields`, `created_at` FROM `assistant_config_audit` WHERE `assistant_id` = ? AND `tenant_id` = ? ORDER BY `id` DESC LIMIT 100', [this.assistantBinary(id), this.tenantBinary()]);
    }
    async maxAssistants(manager) {
        const rows = await this.run(manager, 'SELECT `max_assistants` FROM `tenant_settings` WHERE `tenant_id` = ? FOR UPDATE', [this.tenantBinary()]);
        return rows[0] ? Number(rows[0].max_assistants) : exports.DEFAULT_MAX_ASSISTANTS;
    }
    async countActive(manager) {
        const rows = await this.run(manager, 'SELECT COUNT(*) AS `n` FROM `assistants` WHERE `tenant_id` = ? AND `deleted_at` IS NULL', [this.tenantBinary()]);
        return Number(rows[0]?.n ?? 0);
    }
    async insertAssistant(manager, input) {
        const id = (0, uuid_1.newUuidv7)();
        const tenant = this.tenantBinary();
        const idBin = (0, uuid_1.uuidToBinary)(id);
        try {
            await manager.query('INSERT INTO `assistants` (`id`, `tenant_id`, `name`, `description`, `is_default`, `created_by`) VALUES (?, ?, ?, ?, ?, ?)', [idBin, tenant, input.name, input.description, input.isDefault ? 1 : 0, input.actorId ? (0, uuid_1.uuidToBinary)(input.actorId) : null]);
        }
        catch (error) {
            if (error.code === 'ER_DUP_ENTRY')
                throw new common_1.ConflictException('An assistant with this name already exists.');
            throw error;
        }
        await manager.query('INSERT INTO `assistant_voice_settings` (`assistant_id`, `tenant_id`, `updated_by`) VALUES (?, ?, ?)', [idBin, tenant, input.actorId ? (0, uuid_1.uuidToBinary)(input.actorId) : null]);
        await this.replaceLanguages(manager, id, [...ALL_LANGUAGES], 'en');
        return id;
    }
    async updateAssistantColumns(manager, id, columns) {
        const names = Object.keys(columns);
        const assignments = [...names.map((n) => `\`${n}\` = ?`), '`config_version` = `config_version` + 1'].join(', ');
        try {
            await manager.query(`UPDATE \`assistants\` SET ${assignments} WHERE \`id\` = ? AND \`tenant_id\` = ?`, [...names.map((n) => columns[n]), this.assistantBinary(id), this.tenantBinary()]);
        }
        catch (error) {
            if (error.code === 'ER_DUP_ENTRY')
                throw new common_1.ConflictException('An assistant with this name already exists.');
            throw error;
        }
    }
    async updateVoiceColumns(manager, id, columns, actorId) {
        const names = Object.keys(columns);
        await manager.query(`UPDATE \`assistant_voice_settings\` SET ${[...names.map((n) => `\`${n}\` = ?`), '`updated_by` = ?'].join(', ')} WHERE \`assistant_id\` = ? AND \`tenant_id\` = ?`, [...names.map((n) => columns[n]), actorId ? (0, uuid_1.uuidToBinary)(actorId) : null, this.assistantBinary(id), this.tenantBinary()]);
    }
    async bumpVersion(manager, id) {
        await manager.query('UPDATE `assistants` SET `config_version` = `config_version` + 1 WHERE `id` = ? AND `tenant_id` = ?', [this.assistantBinary(id), this.tenantBinary()]);
    }
    async replaceLanguages(manager, id, enabled, defaultLanguage) {
        const idBin = this.assistantBinary(id);
        const tenant = this.tenantBinary();
        await manager.query('DELETE FROM `assistant_language_settings` WHERE `assistant_id` = ? AND `tenant_id` = ?', [idBin, tenant]);
        for (const code of ALL_LANGUAGES) {
            await manager.query('INSERT INTO `assistant_language_settings` (`assistant_id`, `tenant_id`, `language_code`, `is_enabled`, `is_default`) VALUES (?, ?, ?, ?, ?)', [idBin, tenant, code, enabled.includes(code) ? 1 : 0, code === defaultLanguage ? 1 : 0]);
        }
    }
    async insertInstructions(manager, id, systemPrompt, guardrailNotes, actorId) {
        const idBin = this.assistantBinary(id);
        const tenant = this.tenantBinary();
        const rows = await manager.query('SELECT COALESCE(MAX(`version`), 0) AS `v` FROM `assistant_instructions` WHERE `assistant_id` = ? AND `tenant_id` = ?', [idBin, tenant]);
        const version = Number(rows[0]?.v ?? 0) + 1;
        await manager.query('UPDATE `assistant_instructions` SET `is_active` = 0 WHERE `assistant_id` = ? AND `tenant_id` = ?', [idBin, tenant]);
        await manager.query('INSERT INTO `assistant_instructions` (`assistant_id`, `tenant_id`, `version`, `system_prompt`, `guardrail_notes`, `is_active`, `created_by`) VALUES (?, ?, ?, ?, ?, 1, ?)', [idBin, tenant, version, systemPrompt, guardrailNotes, actorId ? (0, uuid_1.uuidToBinary)(actorId) : null]);
        return version;
    }
    async upsertSecret(manager, id, kind, ciphertext, actorId) {
        await manager.query('INSERT INTO `assistant_provider_secrets` (`assistant_id`, `tenant_id`, `kind`, `ciphertext`, `updated_by`) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE `ciphertext` = VALUES(`ciphertext`), `updated_by` = VALUES(`updated_by`)', [this.assistantBinary(id), this.tenantBinary(), kind, ciphertext, actorId ? (0, uuid_1.uuidToBinary)(actorId) : null]);
    }
    async deleteSecret(manager, id, kind) {
        await manager.query('DELETE FROM `assistant_provider_secrets` WHERE `assistant_id` = ? AND `tenant_id` = ? AND `kind` = ?', [this.assistantBinary(id), this.tenantBinary(), kind]);
    }
    async writeAudit(manager, id, action, configVersion, fields, actorId) {
        await manager.query('INSERT INTO `assistant_config_audit` (`assistant_id`, `tenant_id`, `actor_user_id`, `action`, `config_version`, `changed_fields`) VALUES (?, ?, ?, ?, ?, ?)', [this.assistantBinary(id), this.tenantBinary(), actorId ? (0, uuid_1.uuidToBinary)(actorId) : null, action, configVersion, fields.join(',').slice(0, 1000)]);
    }
    tenantIdForAad() {
        return this.currentTenantId();
    }
    toId(binary) {
        return (0, uuid_1.binaryToUuid)(binary);
    }
};
exports.AssistantRepository = AssistantRepository;
exports.AssistantRepository = AssistantRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], AssistantRepository);
//# sourceMappingURL=assistant.repository.js.map