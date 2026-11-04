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
exports.AuditInterceptor = exports.Audited = exports.AUDITED = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const rxjs_1 = require("rxjs");
const auth_context_1 = require("../auth/auth-context");
const uuid_1 = require("../common/ids/uuid");
const audit_service_1 = require("./audit.service");
exports.AUDITED = Symbol('MCZEN_AUDITED');
const Audited = (options) => (0, common_1.SetMetadata)(exports.AUDITED, options);
exports.Audited = Audited;
let AuditInterceptor = class AuditInterceptor {
    reflector;
    audit;
    constructor(reflector, audit) {
        this.reflector = reflector;
        this.audit = audit;
    }
    intercept(context, next) {
        const options = this.reflector.get(exports.AUDITED, context.getHandler());
        if (!options)
            return next.handle();
        const request = context.switchToHttp().getRequest();
        const write = (outcome) => { void this.write(options, request, outcome); };
        return next.handle().pipe((0, rxjs_1.tap)({
            next: () => write('success'),
            error: (error) => write(error instanceof common_1.HttpException && error.getStatus() === 403 ? 'denied' : 'failure'),
        }));
    }
    write(options, request, outcome) {
        const user = request[auth_context_1.AUTH_CONTEXT];
        const tenant = request[auth_context_1.TENANT_CONTEXT];
        const params = request.params ?? {};
        const scope = options.scope ?? 'tenant';
        const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};
        const metadata = {};
        const keys = Object.keys(body);
        if (keys.length > 0)
            metadata.fields = keys.slice(0, 20).join(',');
        for (const field of options.valueFields ?? []) {
            if (typeof body[field] === 'string' || typeof body[field] === 'boolean' || typeof body[field] === 'number')
                metadata[field] = body[field];
        }
        for (const field of options.paramFields ?? [])
            if (params[field])
                metadata[field] = params[field];
        const targetTenant = options.tenantParam ? params[options.tenantParam] : undefined;
        const tenantId = targetTenant !== undefined ? ((0, uuid_1.isUuidv7)(targetTenant) ? targetTenant : null) : (tenant?.tenantId ?? user?.activeTenantId ?? null);
        return this.audit.record({
            scope,
            tenantId,
            actorType: scope === 'platform' || user?.platformRole ? 'platform_admin' : 'user',
            actorId: user?.userId,
            action: options.action,
            resourceType: options.resourceType,
            resourceId: options.idParam ? params[options.idParam] : tenantId ?? undefined,
            outcome,
            requestId: request[auth_context_1.REQUEST_ID] ?? tenant?.requestId,
            metadata,
        });
    }
};
exports.AuditInterceptor = AuditInterceptor;
exports.AuditInterceptor = AuditInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector, audit_service_1.AuditService])
], AuditInterceptor);
//# sourceMappingURL=audit.interceptor.js.map