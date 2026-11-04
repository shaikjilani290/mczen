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
exports.WidgetRepository = void 0;
exports.newPublicKey = newPublicKey;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const node_crypto_1 = require("node:crypto");
const typeorm_2 = require("typeorm");
const uuid_1 = require("../common/ids/uuid");
const COLUMNS = ['public_key', 'enabled', 'assistant_id', 'name', 'logo_url', 'primary_color', 'theme', 'position', 'button_style',
    'welcome_message', 'initial_greeting', 'allowed_origins', 'key_rotated_at', 'updated_at'].map((column) => `w.\`${column}\``).join(',');
function newPublicKey() {
    return `wk_${(0, node_crypto_1.randomBytes)(24).toString('base64url')}`;
}
let WidgetRepository = class WidgetRepository {
    source;
    constructor(source) {
        this.source = source;
    }
    async query(sql, params = []) {
        return this.source.query(sql, params);
    }
    async getOrCreate(tenantId) {
        const tenant = (0, uuid_1.uuidToBinary)(tenantId);
        const existing = await this.query(`SELECT ${COLUMNS} FROM \`widget_settings\` w WHERE w.\`tenant_id\`=?`, [tenant]);
        if (existing[0])
            return mapSettings(existing[0]);
        const names = await this.query('SELECT `name` FROM `tenants` WHERE `id`=? AND `deleted_at` IS NULL', [tenant]);
        await this.query(`INSERT IGNORE INTO \`widget_settings\` (\`tenant_id\`,\`public_key\`,\`name\`,\`allowed_origins\`) VALUES (?,?,?,JSON_ARRAY())`, [tenant, newPublicKey(), String(names[0]?.name ?? 'McZEN Assistant').slice(0, 100)]);
        const created = await this.query(`SELECT ${COLUMNS} FROM \`widget_settings\` w WHERE w.\`tenant_id\`=?`, [tenant]);
        return mapSettings(created[0]);
    }
    async update(tenantId, input, userId) {
        await this.getOrCreate(tenantId);
        const map = {
            enabled: ['enabled', (v) => (v ? 1 : 0)],
            assistantId: ['assistant_id', (v) => (v ? (0, uuid_1.uuidToBinary)(v) : null)],
            name: ['name', (v) => v],
            logoUrl: ['logo_url', (v) => v],
            primaryColor: ['primary_color', (v) => v],
            theme: ['theme', (v) => v],
            position: ['position', (v) => v],
            buttonStyle: ['button_style', (v) => v],
            welcomeMessage: ['welcome_message', (v) => v],
            initialGreeting: ['initial_greeting', (v) => v],
            allowedOrigins: ['allowed_origins', (v) => JSON.stringify(v)],
        };
        const sets = [];
        const params = [];
        for (const [key, value] of Object.entries(input)) {
            const entry = map[key];
            if (!entry)
                continue;
            sets.push(`\`${entry[0]}\`=?`);
            params.push(entry[1](value));
        }
        sets.push('`updated_by`=?');
        params.push((0, uuid_1.uuidToBinary)(userId), (0, uuid_1.uuidToBinary)(tenantId));
        await this.query(`UPDATE \`widget_settings\` SET ${sets.join(',')} WHERE \`tenant_id\`=?`, params);
        return this.getOrCreate(tenantId);
    }
    async rotateKey(tenantId, userId) {
        await this.getOrCreate(tenantId);
        await this.query('UPDATE `widget_settings` SET `public_key`=?,`key_rotated_at`=UTC_TIMESTAMP(3),`updated_by`=? WHERE `tenant_id`=?', [newPublicKey(), (0, uuid_1.uuidToBinary)(userId), (0, uuid_1.uuidToBinary)(tenantId)]);
        return this.getOrCreate(tenantId);
    }
    async findByPublicKey(publicKey) {
        const rows = await this.query(`SELECT w.\`tenant_id\`,${COLUMNS} FROM \`widget_settings\` w
       JOIN \`tenants\` t ON t.\`id\`=w.\`tenant_id\`
       WHERE w.\`public_key\`=? AND t.\`status\`='active' AND t.\`deleted_at\` IS NULL`, [publicKey]);
        const row = rows[0];
        return row ? { tenantId: (0, uuid_1.binaryToUuid)(row.tenant_id), settings: mapSettings(row) } : undefined;
    }
    async findForTenant(tenantId) {
        const rows = await this.query(`SELECT w.\`tenant_id\`,${COLUMNS} FROM \`widget_settings\` w
       JOIN \`tenants\` t ON t.\`id\`=w.\`tenant_id\`
       WHERE w.\`tenant_id\`=? AND t.\`status\`='active' AND t.\`deleted_at\` IS NULL`, [(0, uuid_1.uuidToBinary)(tenantId)]);
        const row = rows[0];
        return row ? { tenantId, settings: mapSettings(row) } : undefined;
    }
    async resolveAssistant(tenantId, preferred) {
        const tenant = (0, uuid_1.uuidToBinary)(tenantId);
        const rows = await this.query(`SELECT a.\`id\`,a.\`name\`,a.\`greeting_message\`,a.\`branding_display_name\` FROM \`assistants\` a
       WHERE a.\`tenant_id\`=? AND a.\`status\`='active' AND a.\`deleted_at\` IS NULL
       ORDER BY (a.\`id\`=?) DESC, a.\`is_default\` DESC, a.\`created_at\` ASC LIMIT 1`, [tenant, preferred ? (0, uuid_1.uuidToBinary)(preferred) : Buffer.alloc(16)]);
        const assistant = rows[0];
        if (!assistant)
            return undefined;
        const languages = await this.query('SELECT `language_code`,`is_default` FROM `assistant_language_settings` WHERE `assistant_id`=? AND `tenant_id`=? AND `is_enabled`=1', [assistant.id, tenant]);
        const codes = languages.map((row) => String(row.language_code)).filter((code) => ['en', 'hi', 'te'].includes(code));
        return {
            id: (0, uuid_1.binaryToUuid)(assistant.id),
            name: String(assistant.name),
            greeting: assistant.greeting_message ?? null,
            languages: codes.length ? codes : ['en'],
            defaultLanguage: String(languages.find((row) => Number(row.is_default) === 1)?.language_code ?? codes[0] ?? 'en'),
        };
    }
    async createWidgetConversation(tenantId, assistantId, language) {
        const id = (0, uuid_1.newUuidv7)();
        await this.query(`INSERT INTO \`conversations\` (\`id\`,\`tenant_id\`,\`assistant_id\`,\`user_id\`,\`title\`,\`channel\`,\`language_code\`)
       VALUES (?,?,?,NULL,NULL,'widget',?)`, [(0, uuid_1.uuidToBinary)(id), (0, uuid_1.uuidToBinary)(tenantId), (0, uuid_1.uuidToBinary)(assistantId), language]);
        return id;
    }
    async analytics(tenantId, range) {
        const tenant = (0, uuid_1.uuidToBinary)(tenantId);
        const span = [tenant, range.from, range.to];
        const [totals, daily, modality, languages, tools, assistants, knowledge, voice, widgetCount] = await Promise.all([
            this.query(`SELECT COUNT(*) AS conversations, SUM(c.\`channel\`='voice') AS voice, SUM(c.\`channel\`='chat') AS chat,
           SUM(c.\`channel\`='widget') AS widget FROM \`conversations\` c
         WHERE c.\`tenant_id\`=? AND c.\`deleted_at\` IS NULL AND c.\`created_at\`>=? AND c.\`created_at\`<?`, span),
            this.query(`SELECT DATE(c.\`created_at\`) AS day, COUNT(*) AS total FROM \`conversations\` c
         WHERE c.\`tenant_id\`=? AND c.\`deleted_at\` IS NULL AND c.\`created_at\`>=? AND c.\`created_at\`<?
         GROUP BY day ORDER BY day`, span),
            this.query(`SELECT m.\`modality\` AS modality, COUNT(*) AS total FROM \`conversation_messages\` m
         WHERE m.\`tenant_id\`=? AND m.\`created_at\`>=? AND m.\`created_at\`<? GROUP BY m.\`modality\``, span),
            this.query(`SELECT COALESCE(m.\`language_code\`,'unknown') AS language, COUNT(*) AS total FROM \`conversation_messages\` m
         WHERE m.\`tenant_id\`=? AND m.\`role\`='user' AND m.\`created_at\`>=? AND m.\`created_at\`<?
         GROUP BY language ORDER BY total DESC LIMIT 20`, span),
            this.query(`SELECT l.\`tool_name\` AS tool, l.\`outcome\` AS outcome, COUNT(*) AS total FROM \`tool_execution_logs\` l
         WHERE l.\`tenant_id\`=? AND l.\`started_at\`>=? AND l.\`started_at\`<?
         GROUP BY l.\`tool_name\`, l.\`outcome\` ORDER BY total DESC LIMIT 100`, span),
            this.query(`SELECT a.\`id\` AS id, a.\`name\` AS name, COUNT(*) AS total FROM \`conversations\` c
         JOIN \`assistants\` a ON a.\`id\`=c.\`assistant_id\` AND a.\`tenant_id\`=c.\`tenant_id\`
         WHERE c.\`tenant_id\`=? AND c.\`deleted_at\` IS NULL AND c.\`created_at\`>=? AND c.\`created_at\`<?
         GROUP BY a.\`id\`, a.\`name\` ORDER BY total DESC LIMIT 50`, span),
            this.query(`SELECT SUM(\`status\`='published') AS published, COUNT(*) AS total FROM \`knowledge_articles\` WHERE \`tenant_id\`=?`, [tenant]),
            this.query(`SELECT COUNT(*) AS active FROM \`voice_sessions\` WHERE \`tenant_id\`=? AND \`ended_at\` IS NULL
         AND \`last_active_at\`>=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE)`, [tenant]),
            this.query('SELECT COUNT(*) AS total FROM `conversation_messages` WHERE `tenant_id`=? AND `created_at`>=? AND `created_at`<?', span),
        ]);
        const n = (value) => Number(value ?? 0);
        return {
            range: { from: range.from.toISOString().slice(0, 10), to: new Date(range.to.getTime() - 86_400_000).toISOString().slice(0, 10) },
            totals: {
                conversations: n(totals[0]?.conversations),
                messages: n(widgetCount[0]?.total),
                voiceConversations: n(totals[0]?.voice),
                textConversations: n(totals[0]?.chat),
                widgetConversations: n(totals[0]?.widget),
                knowledgeArticles: n(knowledge[0]?.total),
                publishedKnowledgeArticles: n(knowledge[0]?.published),
                activeVoiceSessions: n(voice[0]?.active),
            },
            dailyConversations: daily.map((row) => ({ day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day), total: n(row.total) })),
            messagesByModality: modality.map((row) => ({ modality: String(row.modality), total: n(row.total) })),
            languageDistribution: languages.map((row) => ({ language: String(row.language), total: n(row.total) })),
            toolUsage: tools.map((row) => ({ tool: String(row.tool), outcome: String(row.outcome), total: n(row.total) })),
            assistantUsage: assistants.map((row) => ({ assistantId: (0, uuid_1.binaryToUuid)(row.id), name: String(row.name), conversations: n(row.total) })),
        };
    }
    async platformTenants(page, pageSize) {
        const rows = await this.query(`SELECT t.\`id\`,t.\`name\`,t.\`slug\`,t.\`status\`,t.\`created_at\`,
         (SELECT COUNT(*) FROM \`assistants\` a WHERE a.\`tenant_id\`=t.\`id\` AND a.\`deleted_at\` IS NULL) AS assistants,
         (SELECT COUNT(*) FROM \`conversations\` c WHERE c.\`tenant_id\`=t.\`id\` AND c.\`deleted_at\` IS NULL) AS conversations,
         (SELECT w.\`enabled\` FROM \`widget_settings\` w WHERE w.\`tenant_id\`=t.\`id\`) AS widget_enabled
       FROM \`tenants\` t WHERE t.\`deleted_at\` IS NULL ORDER BY t.\`created_at\` DESC LIMIT ? OFFSET ?`, [pageSize, (page - 1) * pageSize]);
        const total = await this.query('SELECT COUNT(*) AS total FROM `tenants` WHERE `deleted_at` IS NULL');
        return {
            items: rows.map((row) => ({
                id: (0, uuid_1.binaryToUuid)(row.id), name: String(row.name), slug: String(row.slug), status: String(row.status),
                createdAt: row.created_at, assistants: Number(row.assistants), conversations: Number(row.conversations),
                widgetEnabled: row.widget_enabled === null ? null : Number(row.widget_enabled) === 1,
            })),
            page, pageSize, total: Number(total[0]?.total ?? 0),
        };
    }
    async platformOverview() {
        const rows = await this.query(`SELECT (SELECT COUNT(*) FROM \`tenants\` WHERE \`deleted_at\` IS NULL) AS tenants,
         (SELECT COUNT(*) FROM \`tenants\` WHERE \`deleted_at\` IS NULL AND \`status\`='active') AS active_tenants,
         (SELECT COUNT(*) FROM \`assistants\` WHERE \`deleted_at\` IS NULL) AS assistants,
         (SELECT COUNT(*) FROM \`conversations\` WHERE \`deleted_at\` IS NULL) AS conversations,
         (SELECT COUNT(*) FROM \`widget_settings\` WHERE \`enabled\`=1) AS widgets`);
        const row = rows[0] ?? {};
        return {
            tenants: Number(row.tenants ?? 0), activeTenants: Number(row.active_tenants ?? 0), assistants: Number(row.assistants ?? 0),
            conversations: Number(row.conversations ?? 0), enabledWidgets: Number(row.widgets ?? 0),
        };
    }
    async setTenantStatus(tenantId, status, reason) {
        const result = await this.source.query(`UPDATE \`tenants\` SET \`status\`=?,\`suspended_at\`=${status === 'suspended' ? 'UTC_TIMESTAMP(3)' : 'NULL'},\`suspended_reason\`=?
       WHERE \`id\`=? AND \`deleted_at\` IS NULL AND \`status\`<>'closed'`, [status, status === 'suspended' ? reason : null, (0, uuid_1.uuidToBinary)(tenantId)]);
        return (result.affectedRows ?? 0) > 0;
    }
};
exports.WidgetRepository = WidgetRepository;
exports.WidgetRepository = WidgetRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], WidgetRepository);
function mapSettings(row) {
    const origins = typeof row.allowed_origins === 'string' ? JSON.parse(row.allowed_origins) : row.allowed_origins;
    return {
        publicKey: String(row.public_key),
        enabled: Number(row.enabled) === 1,
        assistantId: row.assistant_id ? (0, uuid_1.binaryToUuid)(row.assistant_id) : null,
        name: String(row.name),
        logoUrl: row.logo_url ?? null,
        primaryColor: String(row.primary_color),
        theme: row.theme,
        position: row.position,
        buttonStyle: row.button_style,
        welcomeMessage: row.welcome_message ?? null,
        initialGreeting: row.initial_greeting ?? null,
        allowedOrigins: Array.isArray(origins) ? origins.map(String) : [],
        keyRotatedAt: row.key_rotated_at ? new Date(row.key_rotated_at).toISOString() : null,
        updatedAt: new Date(row.updated_at).toISOString(),
    };
}
//# sourceMappingURL=widget.repository.js.map