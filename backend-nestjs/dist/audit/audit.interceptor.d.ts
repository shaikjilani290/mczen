import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { AuditService } from './audit.service';
export declare const AUDITED: unique symbol;
export interface AuditedOptions {
    action: string;
    resourceType: string;
    scope?: 'tenant' | 'platform';
    idParam?: string;
    tenantParam?: string;
    paramFields?: readonly string[];
    valueFields?: readonly string[];
}
export declare const Audited: (options: AuditedOptions) => import("@nestjs/common", { with: { "resolution-mode": "import" } }).CustomDecorator<typeof AUDITED>;
export declare class AuditInterceptor implements NestInterceptor {
    private readonly reflector;
    private readonly audit;
    constructor(reflector: Reflector, audit: AuditService);
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>;
    private write;
}
