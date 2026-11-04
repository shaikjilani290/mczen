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
exports.ToolConfigurationRepository = void 0;
exports.secretAad = secretAad;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const uuid_1 = require("../common/ids/uuid");
const tenant_scoped_repository_1 = require("../common/tenant/tenant-scoped.repository");
const tool_secret_cipher_1 = require("./tool-secret-cipher");
let ToolConfigurationRepository = class ToolConfigurationRepository extends tenant_scoped_repository_1.TenantScopedRepository {
    source;
    secretCipher;
    constructor(source, secretCipher) {
        super(undefined);
        this.source = source;
        this.secretCipher = secretCipher;
    }
    get configured() { return Boolean(this.source); }
    get database() {
        if (!this.source)
            throw new common_1.ServiceUnavailableException('Tool configuration is unavailable.');
        return this.source;
    }
    tenant() {
        const id = this.currentTenantId();
        return { id, binary: (0, uuid_1.uuidToBinary)(id) };
    }
    async run(sql, params = [], manager) {
        return (manager ?? this.database).query(sql, params);
    }
    async syncCatalog(definitions) {
        await this.database.transaction(async (manager) => {
            for (const definition of definitions) {
                await manager.query(`INSERT INTO \`tools\` (\`name\`,\`display_name\`,\`description\`,\`category\`,\`input_schema\`,
             \`handler_ref\`,\`timeout_ms\`,\`requires_confirmation\`,\`requires_permission_set\`)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE \`display_name\`=VALUES(\`display_name\`), \`description\`=VALUES(\`description\`),
             \`category\`=VALUES(\`category\`), \`input_schema\`=VALUES(\`input_schema\`), \`handler_ref\`=VALUES(\`handler_ref\`),
             \`timeout_ms\`=VALUES(\`timeout_ms\`), \`requires_confirmation\`=VALUES(\`requires_confirmation\`),
             \`requires_permission_set\`=VALUES(\`requires_permission_set\`)`, [
                    definition.name,
                    definition.name.replace(/_/g, ' '),
                    definition.description,
                    definition.category,
                    JSON.stringify(definition.inputSchema),
                    definition.name,
                    definition.timeoutMs,
                    definition.requiresConfirmation ? 1 : 0,
                    definition.requiredPermissions.length ? 1 : 0,
                ]);
                const rows = await manager.query('SELECT `id` FROM `tools` WHERE `name`=?', [definition.name]);
                const toolId = rows[0]?.id;
                if (toolId === undefined)
                    throw new common_1.ServiceUnavailableException('Tool catalog synchronization failed.');
                await manager.query('DELETE FROM `tool_permissions` WHERE `tool_id`=?', [toolId]);
                for (const permission of definition.requiredPermissions) {
                    await manager.query('INSERT INTO `permissions` (`key`,`description`,`category`) VALUES (?,?,?) ON DUPLICATE KEY UPDATE `key`=VALUES(`key`)', [permission, `Required to use ${definition.name}.`, permission.split(':')[0]]);
                    await manager.query('INSERT INTO `tool_permissions` (`tool_id`,`permission_id`) SELECT ?,`id` FROM `permissions` WHERE `key`=?', [toolId, permission]);
                }
            }
        });
    }
    async listTenantTools(definitions, assistantId) {
        const { binary } = this.tenant();
        const rows = await this.run(`SELECT t.\`id\`,t.\`name\`,t.\`display_name\`,t.\`description\`,t.\`category\`,t.\`is_active\`,
          tt.\`enabled\` AS \`tenant_enabled\`,tt.\`extra_permissions\`,tt.\`max_calls_per_conversation\`,
          tc.\`config\`,tc.\`is_active\` AS \`config_active\`,
          ts.\`last_rotated_at\`,ts.\`expires_at\`,ts.\`revoked_at\`
       FROM \`tools\` t
       LEFT JOIN \`tenant_tools\` tt ON tt.\`tool_id\`=t.\`id\` AND tt.\`tenant_id\`=?
       LEFT JOIN \`tool_configurations\` tc ON tc.\`tool_id\`=t.\`id\` AND tc.\`tenant_id\`=?
       LEFT JOIN \`tool_secrets\` ts ON ts.\`tenant_id\`=? AND ts.\`key_label\`=CONCAT(t.\`name\`,':credential')
       ORDER BY t.\`category\`,t.\`name\``, [binary, binary, binary]);
        const names = new Set(definitions.map((definition) => definition.name));
        const filtered = rows.filter((row) => names.has(String(row.name)));
        const permissions = await this.run(`SELECT t.\`name\`,p.\`key\` FROM \`tool_permissions\` tp
       JOIN \`tools\` t ON t.\`id\`=tp.\`tool_id\`
       JOIN \`permissions\` p ON p.\`id\`=tp.\`permission_id\`
       WHERE t.\`name\` IN (${[...names].map(() => '?').join(',') || "''"})`, [...names]);
        const permissionMap = new Map();
        for (const permission of permissions) {
            const key = String(permission.name);
            permissionMap.set(key, [...(permissionMap.get(key) ?? []), String(permission.key)]);
        }
        for (const row of filtered)
            row.required_permissions = permissionMap.get(String(row.name)) ?? [];
        let targetAssistant = assistantId;
        if (!targetAssistant) {
            const defaults = await this.run('SELECT `id` FROM `assistants` WHERE `tenant_id`=? AND `is_default`=1 AND `deleted_at` IS NULL LIMIT 1', [binary]);
            if (defaults[0]) {
                const bytes = Buffer.from(defaults[0].id);
                const hex = bytes.toString('hex');
                targetAssistant = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
            }
        }
        if (targetAssistant) {
            if (!(0, uuid_1.isUuidv7)(targetAssistant))
                throw new common_1.NotFoundException('Assistant not found.');
            const overlay = await this.run('SELECT `tool_id`,`enabled` FROM `assistant_tools` WHERE `tenant_id`=? AND `assistant_id`=?', [binary, (0, uuid_1.uuidToBinary)(targetAssistant)]);
            const toolIds = new Map(overlay.map((entry) => [String(entry.tool_id), entry.enabled === 1]));
            if (assistantId || overlay.length > 0) {
                for (const row of filtered) {
                    row.assistant_enabled = toolIds.get(String(row.id)) === true;
                }
            }
            else {
                for (const row of filtered)
                    row.assistant_enabled = true;
            }
        }
        else {
            for (const row of filtered)
                row.assistant_enabled = !assistantId;
        }
        return filtered;
    }
    async executionSettings(name, definition, assistantId) {
        const { binary } = this.tenant();
        const rows = await this.run(`SELECT t.\`id\`,t.\`is_active\`,t.\`timeout_ms\`,t.\`requires_confirmation\`,
          tt.\`enabled\`,tt.\`extra_permissions\`,tc.\`config\`,tc.\`is_active\` AS \`config_active\`
       FROM \`tools\` t
       LEFT JOIN \`tenant_tools\` tt ON tt.\`tool_id\`=t.\`id\` AND tt.\`tenant_id\`=?
       LEFT JOIN \`tool_configurations\` tc ON tc.\`tool_id\`=t.\`id\` AND tc.\`tenant_id\`=?
       WHERE t.\`name\`=? LIMIT 1`, [binary, binary, name]);
        const row = rows[0];
        if (!row)
            return { available: false, enabled: false, requiredPermissions: [], config: {}, secrets: {}, timeoutMs: definition.timeoutMs, requiresConfirmation: definition.requiresConfirmation };
        const toolId = row.id;
        const available = row.enabled !== null && row.enabled !== undefined;
        let targetAssistant = assistantId;
        if (!targetAssistant) {
            const defaults = await this.run('SELECT `id` FROM `assistants` WHERE `tenant_id`=? AND `is_default`=1 AND `deleted_at` IS NULL LIMIT 1', [binary]);
            if (defaults[0]) {
                const hex = Buffer.from(defaults[0].id).toString('hex');
                targetAssistant = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
            }
        }
        let assistantEnabled = true;
        if (targetAssistant) {
            if (!(0, uuid_1.isUuidv7)(targetAssistant))
                throw new common_1.NotFoundException('Assistant not found.');
            const assistant = await this.run('SELECT `enabled` FROM `assistant_tools` WHERE `tenant_id`=? AND `assistant_id`=? AND `tool_id`=?', [binary, (0, uuid_1.uuidToBinary)(targetAssistant), toolId]);
            if (assistant[0]) {
                assistantEnabled = assistant[0].enabled === 1 || assistant[0].enabled === true;
            }
            else if (assistantId) {
                assistantEnabled = false;
            }
            else {
                const configured = await this.run('SELECT 1 AS `configured` FROM `assistant_tools` WHERE `tenant_id`=? AND `assistant_id`=? LIMIT 1', [binary, (0, uuid_1.uuidToBinary)(targetAssistant)]);
                if (configured.length)
                    assistantEnabled = false;
            }
        }
        const permissions = await this.run(`SELECT p.\`key\` FROM \`tool_permissions\` tp JOIN \`permissions\` p ON p.\`id\`=tp.\`permission_id\`
       WHERE tp.\`tool_id\`=? ORDER BY p.\`key\``, [toolId]);
        const extras = parseJsonArray(row.extra_permissions);
        const configured = parseJsonObject(row.config);
        return {
            available,
            enabled: row.is_active === 1 &&
                row.enabled === 1 &&
                assistantEnabled &&
                (row.config_active === null || row.config_active === 1 || row.config_active === true),
            requiredPermissions: [...new Set([
                    ...permissions.map((permission) => String(permission.key)),
                    ...definition.requiredPermissions,
                    ...extras,
                ])],
            config: configured,
            secrets: {},
            timeoutMs: Number(row.timeout_ms),
            requiresConfirmation: row.requires_confirmation === 1 || row.requires_confirmation === true,
        };
    }
    async executionSecrets(name) {
        if (!this.secretCipher)
            throw new common_1.ServiceUnavailableException('Tool secret storage is not configured.');
        const { id: tenantId, binary } = this.tenant();
        const rows = await this.run(`SELECT \`key_label\`,\`key_version\`,\`ciphertext\`,\`iv\`,\`auth_tag\`
       FROM \`tool_secrets\` WHERE \`tenant_id\`=? AND \`key_label\`=? AND \`revoked_at\` IS NULL
         AND (\`expires_at\` IS NULL OR \`expires_at\`>UTC_TIMESTAMP(3))`, [binary, `${name}:credential`]);
        if (!rows[0])
            return {};
        const secret = rows[0];
        const value = this.secretCipher.decrypt({
            keyVersion: Number(secret.key_version),
            ciphertext: Buffer.from(secret.ciphertext),
            iv: Buffer.from(secret.iv),
            authTag: Buffer.from(secret.auth_tag),
        }, secretAad(tenantId, name, String(secret.key_label), Number(secret.key_version)));
        await this.database.query('UPDATE `tool_secrets` SET `last_used_at`=UTC_TIMESTAMP(3) WHERE `tenant_id`=? AND `key_label`=? AND `revoked_at` IS NULL', [binary, `${name}:credential`]);
        return { credential: value };
    }
    async detail(name) {
        const { binary } = this.tenant();
        const rows = await this.run(`SELECT t.\`id\`,t.\`name\`,t.\`display_name\`,t.\`description\`,t.\`category\`,t.\`input_schema\`,t.\`is_active\`,
          tt.\`enabled\`,tt.\`extra_permissions\`,tt.\`max_calls_per_conversation\`,
          tc.\`config\`,tc.\`is_active\` AS \`config_active\`,
          ts.\`last_rotated_at\`,ts.\`expires_at\`,ts.\`revoked_at\`
       FROM \`tools\` t
       LEFT JOIN \`tenant_tools\` tt ON tt.\`tool_id\`=t.\`id\` AND tt.\`tenant_id\`=?
       LEFT JOIN \`tool_configurations\` tc ON tc.\`tool_id\`=t.\`id\` AND tc.\`tenant_id\`=?
       LEFT JOIN \`tool_secrets\` ts ON ts.\`tenant_id\`=? AND ts.\`key_label\`=CONCAT(t.\`name\`,':credential')
       WHERE t.\`name\`=? LIMIT 1`, [binary, binary, binary, name]);
        if (!rows[0])
            throw new common_1.NotFoundException('Tool not found.');
        const row = rows[0];
        const permissions = await this.run(`SELECT p.\`key\` FROM \`tool_permissions\` tp JOIN \`permissions\` p ON p.\`id\`=tp.\`permission_id\`
       WHERE tp.\`tool_id\`=? ORDER BY p.\`key\``, [row.id]);
        row.required_permissions = permissions.map((permission) => String(permission.key));
        return rows[0];
    }
    async updateTenant(name, actorId, update) {
        const { binary } = this.tenant();
        const id = (0, uuid_1.uuidToBinary)(actorId);
        await this.database.transaction(async (manager) => {
            const toolId = await this.toolId(manager, name);
            if (update.extraPermissions) {
                const values = await this.run(`SELECT \`key\` FROM \`permissions\` WHERE \`key\` IN (${update.extraPermissions.map(() => '?').join(',') || "''"})`, update.extraPermissions, manager);
                if (values.length !== update.extraPermissions.length)
                    throw new common_1.BadRequestException('Unknown permission key.');
            }
            const existing = await this.run('SELECT `id` FROM `tenant_tools` WHERE `tenant_id`=? AND `tool_id`=?', [binary, toolId], manager);
            if (existing[0]) {
                await manager.query(`UPDATE \`tenant_tools\` SET \`enabled\`=COALESCE(?,\`enabled\`),\`extra_permissions\`=COALESCE(?,\`extra_permissions\`),
             \`updated_by\`=? WHERE \`id\`=?`, [
                    update.enabled === undefined ? null : update.enabled ? 1 : 0,
                    update.extraPermissions === undefined ? null : JSON.stringify(update.extraPermissions),
                    id,
                    existing[0].id,
                ]);
            }
            else {
                await manager.query(`INSERT INTO \`tenant_tools\` (\`id\`,\`tenant_id\`,\`tool_id\`,\`enabled\`,\`extra_permissions\`,\`max_calls_per_conversation\`,\`updated_by\`)
           VALUES (?,?,?,?,?,?,?)`, [
                    (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()),
                    binary,
                    toolId,
                    update.enabled === true ? 1 : 0,
                    update.extraPermissions === undefined ? null : JSON.stringify(update.extraPermissions),
                    null,
                    id,
                ]);
            }
            if (update.config !== undefined) {
                await manager.query(`INSERT INTO \`tool_configurations\` (\`id\`,\`tenant_id\`,\`tool_id\`,\`config\`,\`is_active\`,\`updated_by\`)
           VALUES (?,?,?,?,1,?) ON DUPLICATE KEY UPDATE \`config\`=VALUES(\`config\`),\`is_active\`=1,\`updated_by\`=VALUES(\`updated_by\`)`, [(0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()), binary, toolId, JSON.stringify(update.config), id]);
            }
        });
    }
    async setAssistantTool(name, assistantId, enabled) {
        const { binary } = this.tenant();
        const assistantBinary = (0, uuid_1.uuidToBinary)(assistantId);
        const rows = await this.run('SELECT `id` FROM `assistants` WHERE `id`=? AND `tenant_id`=? AND `deleted_at` IS NULL', [assistantBinary, binary]);
        if (!rows[0])
            throw new common_1.NotFoundException('Assistant not found.');
        const toolId = await this.toolId(undefined, name);
        await this.database.query(`INSERT INTO \`assistant_tools\` (\`tenant_id\`,\`assistant_id\`,\`tool_id\`,\`enabled\`)
       VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE \`enabled\`=VALUES(\`enabled\`)`, [binary, assistantBinary, toolId, enabled ? 1 : 0]);
    }
    async secretStatus(name) {
        const { binary } = this.tenant();
        const rows = await this.run(`SELECT \`last_rotated_at\`,\`expires_at\`,\`revoked_at\` FROM \`tool_secrets\`
       WHERE \`tenant_id\`=? AND \`key_label\`=?`, [binary, `${name}:credential`]);
        const row = rows[0];
        return {
            configured: Boolean(row && !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now())),
            lastRotatedAt: row?.last_rotated_at ? new Date(row.last_rotated_at) : null,
            expiresAt: row?.expires_at ? new Date(row.expires_at) : null,
        };
    }
    async setSecret(name, actorId, secret, expiresAt) {
        if (!this.secretCipher)
            throw new common_1.ServiceUnavailableException('Tool secret storage is not configured.');
        const { id: tenantId, binary } = this.tenant();
        const label = `${name}:credential`;
        const encrypted = this.secretCipher.encrypt(secret, secretAad(tenantId, name, label, this.secretCipher.currentVersion()));
        await this.database.query(`INSERT INTO \`tool_secrets\` (\`id\`,\`tenant_id\`,\`key_label\`,\`key_version\`,\`ciphertext\`,\`iv\`,\`auth_tag\`,
        \`last_rotated_at\`,\`expires_at\`,\`revoked_at\`,\`created_by\`)
       VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3),?,NULL,?)
       ON DUPLICATE KEY UPDATE \`key_version\`=VALUES(\`key_version\`),\`ciphertext\`=VALUES(\`ciphertext\`),
        \`iv\`=VALUES(\`iv\`),\`auth_tag\`=VALUES(\`auth_tag\`),\`last_rotated_at\`=UTC_TIMESTAMP(3),
        \`expires_at\`=VALUES(\`expires_at\`),\`revoked_at\`=NULL,\`created_by\`=VALUES(\`created_by\`)`, [
            (0, uuid_1.uuidToBinary)((0, uuid_1.newUuidv7)()), binary, label, encrypted.keyVersion, encrypted.ciphertext,
            encrypted.iv, encrypted.authTag, expiresAt, (0, uuid_1.uuidToBinary)(actorId),
        ]);
    }
    async revokeSecret(name) {
        const { binary } = this.tenant();
        await this.database.query('UPDATE `tool_secrets` SET `revoked_at`=UTC_TIMESTAMP(3) WHERE `tenant_id`=? AND `key_label`=? AND `revoked_at` IS NULL', [binary, `${name}:credential`]);
    }
    async nameById(id) {
        if (!/^[1-9]\d{0,19}$/.test(id))
            throw new common_1.NotFoundException('Tool not found.');
        const rows = await this.run('SELECT `name` FROM `tools` WHERE `id`=? AND `is_active`=1', [id]);
        if (!rows[0])
            throw new common_1.NotFoundException('Tool not found.');
        return String(rows[0].name);
    }
    async toolId(manager, name) {
        const rows = await this.run('SELECT `id` FROM `tools` WHERE `name`=? AND `is_active`=1', [name], manager);
        if (!rows[0])
            throw new common_1.NotFoundException('Tool not found.');
        return rows[0].id;
    }
};
exports.ToolConfigurationRepository = ToolConfigurationRepository;
exports.ToolConfigurationRepository = ToolConfigurationRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource,
        tool_secret_cipher_1.ToolSecretCipher])
], ToolConfigurationRepository);
function parseJsonArray(value) {
    if (!value)
        return [];
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new common_1.ServiceUnavailableException('Stored tool settings are invalid.');
    }
    return parsed;
}
function parseJsonObject(value) {
    if (!value)
        return {};
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new common_1.ServiceUnavailableException('Stored tool configuration is invalid.');
    }
    return parsed;
}
function secretAad(tenantId, toolName, label, version) {
    return `tool-secret:${tenantId}:${toolName}:${label}:${version}`;
}
//# sourceMappingURL=tool-configuration.repository.js.map