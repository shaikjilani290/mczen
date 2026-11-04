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
exports.ToolsService = void 0;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../common/ids/uuid");
const tool_registry_service_1 = require("../agent/tools/tool-registry.service");
const tool_validation_service_1 = require("../agent/tools/tool-validation.service");
const tool_configuration_repository_1 = require("./tool-configuration.repository");
const tool_secret_cipher_1 = require("./tool-secret-cipher");
const EMPTY_CONFIG_SCHEMA = {
    type: 'object',
    required: [],
    properties: {},
    additionalProperties: false,
};
let ToolsService = class ToolsService {
    registry;
    repository;
    validation;
    cipher;
    constructor(registry, repository, validation, cipher) {
        this.registry = registry;
        this.repository = repository;
        this.validation = validation;
        this.cipher = cipher;
    }
    async list() {
        const definitions = this.registry.listDefinitions();
        const rows = await this.repository.listTenantTools(definitions);
        const items = rows.flatMap((row) => {
            const definition = this.registry.getTool(String(row.name));
            if (!definition)
                return [];
            return [{
                    id: String(row.id),
                    name: definition.name,
                    displayName: String(row.display_name),
                    description: definition.description,
                    category: definition.category,
                    enabled: Boolean(row.is_active) && row.tenant_enabled === 1 && row.assistant_enabled === true,
                    requiresConfirmation: definition.requiresConfirmation,
                    requiredPermissions: [...new Set([
                            ...definition.requiredPermissions,
                            ...parseStringArray(row.required_permissions),
                            ...parseStringArray(row.extra_permissions),
                        ])],
                    configConfigured: row.config !== null && row.config !== undefined,
                    secret: {
                        configured: row.revoked_at == null &&
                            row.last_rotated_at != null &&
                            (row.expires_at == null || new Date(row.expires_at).getTime() > Date.now()),
                        lastRotatedAt: row.last_rotated_at ?? null,
                    },
                }];
        });
        return {
            items,
        };
    }
    async get(name) {
        const resolved = await this.resolve(name);
        const { definition, toolName } = resolved;
        const row = await this.repository.detail(toolName);
        const config = parseObject(row.config);
        return {
            id: String(row.id),
            name: definition.name,
            displayName: String(row.display_name),
            description: definition.description,
            category: definition.category,
            enabled: Boolean(row.is_active) && row.enabled === 1,
            requiredPermissions: [...new Set([
                    ...definition.requiredPermissions,
                    ...parseStringArray(row.required_permissions),
                ])],
            inputSchema: definition.inputSchema,
            configurationSchema: definition.configurationSchema ?? EMPTY_CONFIG_SCHEMA,
            tenantConfig: config,
            extraPermissions: parseStringArray(row.extra_permissions),
            secret: {
                configured: row.revoked_at == null && row.last_rotated_at != null &&
                    (row.expires_at == null || new Date(row.expires_at).getTime() > Date.now()),
                lastRotatedAt: row.last_rotated_at ?? null,
                expiresAt: row.expires_at ?? null,
            },
        };
    }
    async update(name, input, user) {
        const { definition, toolName } = await this.resolve(name);
        if (input.config !== undefined) {
            rejectReservedKeys(input.config);
            input = {
                ...input,
                config: this.validation.validateToolInput(definition.name, input.config, definition.configurationSchema ?? EMPTY_CONFIG_SCHEMA),
            };
        }
        await this.repository.updateTenant(toolName, user.userId, input);
        return this.get(toolName);
    }
    async updateAssistant(name, assistantId, enabled) {
        const { toolName } = await this.resolve(name);
        if (!(0, uuid_1.isUuidv7)(assistantId))
            throw new common_1.NotFoundException('Assistant not found.');
        await this.repository.setAssistantTool(toolName, assistantId, enabled);
        return { name: toolName, assistantId, enabled };
    }
    async secretStatus(name) {
        const { toolName } = await this.resolve(name);
        return this.repository.secretStatus(toolName);
    }
    async setSecret(name, value, expiresAt, user) {
        const { toolName } = await this.resolve(name);
        this.cipher.currentVersion();
        await this.repository.setSecret(toolName, user.userId, value, expiresAt);
        return this.repository.secretStatus(toolName);
    }
    async clearSecret(name) {
        const { toolName } = await this.resolve(name);
        await this.repository.revokeSecret(toolName);
        return this.repository.secretStatus(toolName);
    }
    async resolve(reference) {
        const toolName = /^[1-9]\d{0,19}$/.test(reference) ? await this.repository.nameById(reference) : reference;
        const definition = this.registry.getTool(toolName);
        if (!definition)
            throw new common_1.NotFoundException('Tool not found.');
        return { toolName, definition };
    }
};
exports.ToolsService = ToolsService;
exports.ToolsService = ToolsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tool_registry_service_1.ToolRegistryService,
        tool_configuration_repository_1.ToolConfigurationRepository,
        tool_validation_service_1.ToolValidationService,
        tool_secret_cipher_1.ToolSecretCipher])
], ToolsService);
function rejectReservedKeys(value, depth = 0) {
    if (depth > 5)
        throw new common_1.BadRequestException('Tool configuration is nested too deeply.');
    for (const [key, nested] of Object.entries(value)) {
        if (/(secret|password|token|credential|api.?key|authorization|private.?key)/i.test(key)) {
            throw new common_1.BadRequestException('Secret values must use the tenant-secret endpoint.');
        }
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            rejectReservedKeys(nested, depth + 1);
        }
    }
}
function parseObject(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (value == null)
        return {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new common_1.ServiceUnavailableException('Stored tool configuration is invalid.');
    }
    return parsed;
}
function parseStringArray(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
}
//# sourceMappingURL=tools.service.js.map