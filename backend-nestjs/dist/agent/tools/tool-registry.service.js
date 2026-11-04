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
exports.ToolRegistryService = void 0;
const common_1 = require("@nestjs/common");
const uuid_1 = require("../../common/ids/uuid");
const knowledge_service_1 = require("../knowledge.service");
const tool_configuration_repository_1 = require("../../tools/tool-configuration.repository");
const knowledge_search_tool_1 = require("./implementations/knowledge-search.tool");
const get_products_tool_1 = require("./implementations/get-products.tool");
const get_product_details_tool_1 = require("./implementations/get-product-details.tool");
const check_inventory_tool_1 = require("./implementations/check-inventory.tool");
const demo_catalogues_1 = require("./implementations/demo-catalogues");
let ToolRegistryService = class ToolRegistryService {
    knowledge;
    configuration;
    tools = new Map();
    constructor(knowledge, configuration) {
        this.knowledge = knowledge;
        this.configuration = configuration;
    }
    async onModuleInit() {
        this.register((0, knowledge_search_tool_1.createKnowledgeSearchTool)(this.knowledge));
        this.register((0, get_products_tool_1.createGetProductsTool)(demo_catalogues_1.DEMO_PRODUCT_CATALOGUES));
        this.register((0, get_product_details_tool_1.createGetProductDetailsTool)(demo_catalogues_1.DEMO_PRODUCT_CATALOGUES));
        this.register((0, check_inventory_tool_1.createCheckInventoryTool)(demo_catalogues_1.DEMO_PRODUCT_CATALOGUES));
        if (this.configuration?.configured) {
            await this.configuration.syncCatalog([...this.tools.values()]);
        }
    }
    register(tool) {
        if (this.tools.has(tool.name)) {
            throw new common_1.ConflictException(`A tool with the name "${tool.name}" is already registered.`);
        }
        if (tool.tenantMode === 'RESTRICTED' &&
            (!tool.allowedTenants || tool.allowedTenants.length === 0)) {
            throw new common_1.BadRequestException(`Tool "${tool.name}" is RESTRICTED but declares no allowedTenants.`);
        }
        this.tools.set(tool.name, tool);
    }
    unregister(name) {
        return this.tools.delete(name);
    }
    getTool(name) {
        return this.tools.get(name);
    }
    listDefinitions() {
        return [...this.tools.values()];
    }
    hasTool(name) {
        return this.tools.has(name);
    }
    isToolEnabled(name) {
        return this.tools.get(name)?.enabled ?? false;
    }
    isToolAvailableToTenant(name, tenantId) {
        const tool = this.tools.get(name);
        if (!tool) {
            return false;
        }
        if (tool.tenantMode === 'ALL_TENANTS') {
            return true;
        }
        return tool.allowedTenants?.includes(tenantId) ?? false;
    }
    listTools() {
        return [...this.tools.values()].map((tool) => toMetadata(tool));
    }
    listForTenant(tenantId) {
        return [...this.tools.values()]
            .filter((tool) => tool.tenantMode === 'ALL_TENANTS' ||
            tool.allowedTenants?.includes(tenantId) === true)
            .map((tool) => toMetadata(tool));
    }
    async listForTenantAtCallTime(tenantId, assistantId) {
        if (!this.configuration?.configured)
            return this.listForTenant(tenantId);
        if (!(0, uuid_1.isUuidv7)(tenantId)) {
            return process.env.NODE_ENV === 'production' ? [] : this.listForTenant(tenantId);
        }
        const rows = await this.configuration.listTenantTools([...this.tools.values()], assistantId);
        return rows.map((row) => {
            const definition = this.tools.get(String(row.name));
            if (!definition)
                return undefined;
            const metadata = toMetadata(definition);
            metadata.enabled = row.is_active === 1 && row.tenant_enabled === 1 && row.assistant_enabled === true;
            metadata.requiredPermissions = [
                ...new Set([
                    ...metadata.requiredPermissions,
                    ...readStringArray(row.required_permissions),
                    ...readStringArray(row.extra_permissions),
                ]),
            ];
            return metadata;
        }).filter((metadata) => metadata !== undefined);
    }
    async executionSettings(name, tenantId, definition, assistantId) {
        if (!this.configuration?.configured || !(0, uuid_1.isUuidv7)(tenantId)) {
            const available = this.isToolAvailableToTenant(name, tenantId);
            return {
                available,
                enabled: definition.enabled,
                requiredPermissions: [...definition.requiredPermissions],
                config: {},
                secrets: {},
                timeoutMs: definition.timeoutMs,
                requiresConfirmation: definition.requiresConfirmation,
            };
        }
        return this.configuration.executionSettings(name, definition, assistantId);
    }
    async executionSecrets(name, tenantId) {
        if (!this.configuration?.configured || !(0, uuid_1.isUuidv7)(tenantId))
            return {};
        return this.configuration.executionSecrets(name);
    }
};
exports.ToolRegistryService = ToolRegistryService;
exports.ToolRegistryService = ToolRegistryService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [knowledge_service_1.KnowledgeService,
        tool_configuration_repository_1.ToolConfigurationRepository])
], ToolRegistryService);
function toMetadata(tool) {
    return {
        name: tool.name,
        description: tool.description,
        category: tool.category,
        requiredPermissions: [...tool.requiredPermissions],
        enabled: tool.enabled,
        requiresConfirmation: tool.requiresConfirmation,
        inputSchema: {
            ...tool.inputSchema,
            required: [...tool.inputSchema.required],
            properties: Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([property, schema]) => [property, { ...schema }])),
        },
    };
}
function readStringArray(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
}
//# sourceMappingURL=tool-registry.service.js.map