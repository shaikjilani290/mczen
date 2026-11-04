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
var ToolAuditService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolAuditService = void 0;
const common_1 = require("@nestjs/common");
const conversations_repository_1 = require("../../conversations/conversations.repository");
const MAX_AUDIT_RECORDS = 1_000;
let ToolAuditService = ToolAuditService_1 = class ToolAuditService {
    sink;
    logger = new common_1.Logger(ToolAuditService_1.name);
    records = [];
    pending = new Set();
    constructor(sink) {
        this.sink = sink;
    }
    record(entry) {
        const snapshot = { ...entry, argumentsSummary: entry.argumentsSummary ? { keys: [...entry.argumentsSummary.keys] } : undefined,
            resultSummary: entry.resultSummary ? { ...entry.resultSummary } : undefined };
        this.records.push(snapshot);
        if (this.records.length > MAX_AUDIT_RECORDS) {
            this.records.splice(0, this.records.length - MAX_AUDIT_RECORDS);
        }
        if (!this.sink)
            return Promise.resolve();
        const operation = Promise.resolve()
            .then(() => this.sink.persistToolAudit(snapshot))
            .catch(() => {
            this.logger.warn(JSON.stringify({
                event: 'tool_audit_persistence_failed',
                requestId: snapshot.requestId,
                toolName: snapshot.toolName,
            }));
        })
            .finally(() => this.pending.delete(operation));
        this.pending.add(operation);
        return operation;
    }
    list() {
        return [...this.records];
    }
    async flush() {
        await Promise.all([...this.pending]);
    }
};
exports.ToolAuditService = ToolAuditService;
exports.ToolAuditService = ToolAuditService = ToolAuditService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, common_1.Inject)(conversations_repository_1.TOOL_AUDIT_SINK)),
    __metadata("design:paramtypes", [Object])
], ToolAuditService);
//# sourceMappingURL=tool-audit.service.js.map