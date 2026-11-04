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
exports.ReadinessController = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const auth_decorators_1 = require("../auth/auth.decorators");
const audit_service_1 = require("../audit/audit.service");
const shared_state_1 = require("../shared-state/shared-state");
const PROBE_TIMEOUT_MS = 2000;
function withTimeout(work) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
        work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
}
let ReadinessController = class ReadinessController {
    source;
    store;
    audit;
    constructor(source, store, audit) {
        this.source = source;
        this.store = store;
        this.audit = audit;
    }
    async ready(response) {
        response.setHeader('Cache-Control', 'no-store');
        const source = this.source;
        const database = source ? await withTimeout(source.query('SELECT 1')).then(() => true, () => false) : false;
        const auditSchema = source && database
            ? await withTimeout(source.query('SELECT 1 FROM `audit_events` LIMIT 1')).then(() => true, () => false)
            : false;
        const sharedState = await withTimeout(this.store.health()).then((h) => h.ok, () => false);
        const ready = database && sharedState && auditSchema;
        response.status(ready ? 200 : 503);
        return {
            status: ready ? 'ready' : 'not_ready',
            checks: {
                database: database ? 'ok' : 'unavailable',
                auditSchema: auditSchema ? 'ok' : 'unavailable',
                sharedState: sharedState ? 'ok' : 'unavailable',
            },
            sharedStateDriver: this.store.driver,
            auditWriteFailures: this.audit.failureCount,
        };
    }
};
exports.ReadinessController = ReadinessController;
__decorate([
    (0, common_1.Get)('ready'),
    (0, auth_decorators_1.PublicRoute)(),
    __param(0, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReadinessController.prototype, "ready", null);
exports.ReadinessController = ReadinessController = __decorate([
    (0, common_1.Controller)('api/health'),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __param(1, (0, common_1.Inject)(shared_state_1.SHARED_STATE)),
    __metadata("design:paramtypes", [Object, Object, audit_service_1.AuditService])
], ReadinessController);
//# sourceMappingURL=readiness.controller.js.map