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
var AuditService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const uuid_1 = require("../common/ids/uuid");
const audit_sanitize_1 = require("./audit.sanitize");
const clip = (value, max) => (value ? value.slice(0, max) : null);
let AuditService = AuditService_1 = class AuditService {
    source;
    logger = new common_1.Logger(AuditService_1.name);
    failures = 0;
    constructor(source) {
        this.source = source;
    }
    get database() {
        if (!this.source)
            throw new common_1.ServiceUnavailableException('Audit storage is unavailable.');
        return this.source;
    }
    get failureCount() { return this.failures; }
    async record(input) {
        try {
            const metadata = (0, audit_sanitize_1.sanitizeMetadata)(input.metadata);
            await this.database.query('INSERT INTO `audit_events` (`scope`,`tenant_id`,`actor_type`,`actor_id`,`action`,`resource_type`,`resource_id`,`outcome`,`request_id`,`metadata`) VALUES (?,?,?,?,?,?,?,?,?,?)', [
                input.scope,
                input.tenantId ? (0, uuid_1.uuidToBinary)(input.tenantId) : null,
                input.actorType,
                clip(input.actorId, 64),
                input.action.slice(0, 80),
                clip(input.resourceType, 40),
                clip(input.resourceId, 64),
                input.outcome ?? 'success',
                clip(input.requestId, 64),
                metadata ? JSON.stringify(metadata) : null,
            ]);
        }
        catch {
            this.failures += 1;
            this.logger.error(JSON.stringify({ event: 'audit.write_failed', action: input.action.slice(0, 80) }));
        }
    }
    async list(query) {
        const where = ['`scope`=?'];
        const params = [query.scope];
        if (query.tenantId) {
            where.push('`tenant_id`=?');
            params.push((0, uuid_1.uuidToBinary)(query.tenantId));
        }
        if (query.action) {
            where.push('`action`=?');
            params.push(query.action);
        }
        if (query.actorId) {
            where.push('`actor_id`=?');
            params.push(query.actorId);
        }
        if (query.from) {
            where.push('`created_at`>=?');
            params.push(query.from);
        }
        if (query.to) {
            where.push('`created_at`<?');
            params.push(query.to);
        }
        if (query.beforeId) {
            where.push('`id`<?');
            params.push(query.beforeId);
        }
        const limit = Math.min(Math.max(query.limit, 1), 100);
        const rows = await this.database.query(`SELECT * FROM \`audit_events\` WHERE ${where.join(' AND ')} ORDER BY \`id\` DESC LIMIT ${limit + 1}`, params);
        const page = rows.slice(0, limit).map(toView);
        return { items: page, nextBeforeId: rows.length > limit ? page[page.length - 1].id : null };
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = AuditService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], AuditService);
function toView(row) {
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    return {
        id: String(row.id),
        scope: row.scope,
        tenantId: row.tenant_id ? (0, uuid_1.binaryToUuid)(row.tenant_id) : null,
        actorType: row.actor_type,
        actorId: row.actor_id ?? null,
        action: String(row.action),
        resourceType: row.resource_type ?? null,
        resourceId: row.resource_id ?? null,
        outcome: row.outcome,
        requestId: row.request_id ?? null,
        metadata: metadata ?? null,
        createdAt: new Date(row.created_at).toISOString(),
    };
}
//# sourceMappingURL=audit.service.js.map