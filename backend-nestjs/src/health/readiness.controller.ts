import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { PublicRoute } from '../auth/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { SHARED_STATE, type SharedState } from '../shared-state/shared-state';

const PROBE_TIMEOUT_MS = 2000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * Readiness reports only booleans and driver names. It never echoes hosts, credentials, versions or errors.
 * Required dependencies (database, shared state, migration 12) decide the status code; audit write failures are
 * reported but do not take the service out of rotation.
 */
@Controller('api/health')
export class ReadinessController {
  constructor(
    @Optional() @InjectDataSource() private readonly source: DataSource | undefined,
    @Inject(SHARED_STATE) private readonly store: SharedState,
    private readonly audit: AuditService,
  ) {}

  @Get('ready')
  @PublicRoute()
  async ready(@Res({ passthrough: true }) response: Response) {
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
}
