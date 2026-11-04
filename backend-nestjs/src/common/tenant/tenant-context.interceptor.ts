import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TENANT_CONTEXT, type AuthenticatedRequest } from '../../auth/auth-context';
import { tenantContextStore } from './tenant-context.store';

/**
 * Nest invokes async guards before it subscribes to the handler Observable.
 * enterWith() in a guard is not sufficient: establish ALS at the actual RxJS
 * subscription, callbacks AND teardown, so async services cannot lose scope.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tenant = context.switchToHttp().getRequest<AuthenticatedRequest>()[TENANT_CONTEXT];
    if (!tenant) return next.handle();
    return new Observable((subscriber) => {
      const subscription = tenantContextStore.run(tenant, () => next.handle().subscribe({
        next: (value) => tenantContextStore.run(tenant, () => subscriber.next(value)),
        error: (error: unknown) => tenantContextStore.run(tenant, () => subscriber.error(error)),
        complete: () => tenantContextStore.run(tenant, () => subscriber.complete()),
      }));
      return () => tenantContextStore.run(tenant, () => subscription.unsubscribe());
    });
  }
}
