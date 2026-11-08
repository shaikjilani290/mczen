import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Audited } from '../audit/audit.interceptor';
import type { Request } from 'express';
import { CurrentUser, PublicRoute, RequirePermission, RequirePlatform } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth-context';
import { isUuidv7 } from '../common/ids/uuid';
import { parseDateRange, parsePublicMessage, parsePublicSession, parseTenantStatus, parseWidgetSettingsUpdate } from './widget.dto';
import { WidgetRepository } from './widget.repository';
import { WidgetService } from './widget.service';

/** Tenant-admin widget configuration. Tenant is the verified context; the public key never authorizes these routes. */
@Controller('api/widget')
export class WidgetAdminController {
  constructor(private readonly widget: WidgetService) {}

  @Get('settings')
  @RequirePermission('tenants:read')
  settings() { return this.widget.getSettings(); }

  @Patch('settings')
  @Audited({ action: 'widget.settings.update', resourceType: 'widget_settings' })
  @RequirePermission('tenants:write')
  update(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.widget.updateSettings(parseWidgetSettingsUpdate(body), user.userId);
  }

  @Post('settings/rotate-key')
  @Audited({ action: 'widget.key.rotate', resourceType: 'widget_settings' })
  @HttpCode(200)
  @RequirePermission('tenants:write')
  rotate(@CurrentUser() user: AuthenticatedUser) { return this.widget.rotateKey(user.userId); }

  @Get('analytics')
  @RequirePermission('usage:read')
  analytics(@Query() query: Record<string, unknown>) { return this.widget.analytics(parseDateRange(query)); }
}

/**
 * Unauthenticated widget surface. Safety comes from the public key + exact origin allowlist
 * + short-lived signed session + rate limits, not from ambient identity.
 */
@Controller('api/widget/public')
@PublicRoute()
export class WidgetPublicController {
  constructor(private readonly widget: WidgetService) {}

  @Post('session')
  @HttpCode(200)
  session(@Body() body: unknown, @Headers('origin') origin: string | undefined, @Req() request: Request) {
    const input = parsePublicSession(body);
    // request.ip keys the per-IP session limiter on the real client when the
    // trusted local proxy is configured; otherwise on the raw socket peer.
    return this.widget.createSession(input.publicKey, origin, input.language, request.ip ?? request.socket.remoteAddress, input.assistantId);
  }

  @Post('message')
  @HttpCode(200)
  message(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Headers('origin') origin: string | undefined) {
    const input = parsePublicMessage(body);
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    return this.widget.ask(token, origin, input.message, input.language);
  }

  @Post('voice-ticket')
  @HttpCode(200)
  voiceTicket(@Headers('authorization') authorization: string | undefined, @Headers('origin') origin: string | undefined) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    return this.widget.voiceTicket(token, origin);
  }
}

/** McZEN platform staff only (DB-assigned platform:admin role); no tenant bypass for tenant admins. */
@Controller('api/platform')
export class PlatformController {
  constructor(private readonly repository: WidgetRepository) {}

  @Get('overview')
  @RequirePlatform()
  overview() { return this.repository.platformOverview(); }

  @Get('tenants')
  @RequirePlatform()
  tenants(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page === undefined ? 1 : Number(page);
    const size = pageSize === undefined ? 25 : Number(pageSize);
    if (!Number.isInteger(p) || p < 1 || p > 10_000 || !Number.isInteger(size) || size < 1 || size > 100) throw new BadRequestException('Pagination is invalid.');
    return this.repository.platformTenants(p, size);
  }

  @Patch('tenants/:id/status')
  @Audited({ action: 'platform.tenant.status', resourceType: 'tenant', scope: 'platform', idParam: 'id', tenantParam: 'id', valueFields: ['status'] })
  @RequirePlatform()
  async setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    if (!isUuidv7(id)) throw new BadRequestException('Tenant id is invalid.');
    const input = parseTenantStatus(body);
    if (!(await this.repository.setTenantStatus(id, input.status, input.reason))) throw new BadRequestException('Tenant status cannot be changed.');
    return { id, status: input.status };
  }
}
