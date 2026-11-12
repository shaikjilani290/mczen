import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Audited } from '../audit/audit.interceptor';
import { CurrentUser, PublicRoute, RequirePermission } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth-context';
import { isUuidv7 } from '../common/ids/uuid';
import { parsePublicMessage } from '../widget/widget.dto';
import { WidgetService } from '../widget/widget.service';
import { parseCreateWebsiteIntegration, parseSiteConnect } from './website-integration.dto';
import { WebsiteIntegrationService } from './website-integration.service';

function pagination(query: Record<string, unknown>): { page: number; pageSize: number } {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 25 : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1 || page > 100_000 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BadRequestException('Pagination is invalid.');
  }
  return { page, pageSize };
}

function integrationId(value: string): string {
  if (!isUuidv7(value)) throw new BadRequestException('Integration id is invalid.');
  return value;
}

function bearer(value: string | undefined): string | undefined {
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : undefined;
}

@Controller('api/website-integrations')
export class WebsiteIntegrationAdminController {
  constructor(private readonly service: WebsiteIntegrationService) {}

  @Get()
  @RequirePermission('tenants:read')
  list() {
    return this.service.list();
  }

  @Post()
  @HttpCode(201)
  @Audited({ action: 'website_integration.create', resourceType: 'website_integration' })
  @RequirePermission('tenants:write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(parseCreateWebsiteIntegration(body), user.userId);
  }

  @Get(':id/status')
  @RequirePermission('tenants:read')
  status(@Param('id') id: string) {
    return this.service.status(integrationId(id));
  }

  @Get(':id/pages')
  @RequirePermission('tenants:read')
  pages(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    const { page, pageSize } = pagination(query);
    return this.service.pages(integrationId(id), page, pageSize);
  }

  @Get(':id/products')
  @RequirePermission('tenants:read')
  products(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    const { page, pageSize } = pagination(query);
    return this.service.products(integrationId(id), page, pageSize);
  }

  @Get(':id/knowledge')
  @RequirePermission('tenants:read')
  knowledge(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    const { page, pageSize } = pagination(query);
    return this.service.knowledgeList(integrationId(id), page, pageSize);
  }

  @Post(':id/sync')
  @HttpCode(202)
  @Audited({ action: 'website_integration.sync', resourceType: 'website_integration', idParam: 'id' })
  @RequirePermission('tenants:write')
  sync(@Param('id') id: string) {
    return this.service.beginSync(integrationId(id));
  }

  @Post(':id/rebuild-index')
  @HttpCode(200)
  @Audited({ action: 'website_integration.rebuild_index', resourceType: 'website_integration', idParam: 'id' })
  @RequirePermission('tenants:write')
  rebuildIndex(@Param('id') id: string) {
    return this.service.rebuildIndex(integrationId(id));
  }

  @Post(':id/keys/rotate')
  @HttpCode(200)
  @Audited({ action: 'website_integration.keys.rotate', resourceType: 'website_integration', idParam: 'id' })
  @RequirePermission('tenants:write')
  rotateKeys(@Param('id') id: string) {
    return this.service.rotateKeys(integrationId(id));
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Audited({ action: 'website_integration.revoke', resourceType: 'website_integration', idParam: 'id' })
  @RequirePermission('tenants:write')
  revoke(@Param('id') id: string) {
    return this.service.revoke(integrationId(id));
  }
}

/** Public integration endpoints still require exact Origin and a short-lived scoped session. */
@Controller('api/website-integrations')
@PublicRoute()
export class WebsiteIntegrationPublicController {
  constructor(private readonly widget: WidgetService) {}

  @Post('connect')
  @HttpCode(200)
  connect(@Body() body: unknown, @Headers('origin') origin: string | undefined, @Req() request: Request) {
    const input = parseSiteConnect(body);
    return this.widget.createSession(
      input.publicKey, origin, input.language, request.ip ?? request.socket.remoteAddress, input.assistantId,
    );
  }

  @Post('message')
  @HttpCode(200)
  message(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Headers('origin') origin: string | undefined) {
    const input = parsePublicMessage(body);
    return this.widget.ask(bearer(authorization), origin, input.message, input.language, input.requestId);
  }

  @Post('voice-ticket')
  @HttpCode(200)
  voiceTicket(@Headers('authorization') authorization: string | undefined, @Headers('origin') origin: string | undefined) {
    return this.widget.voiceTicket(bearer(authorization), origin);
  }

  @Post('cart/poll')
  @HttpCode(200)
  cartPoll(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Headers('origin') origin: string | undefined) {
    return this.widget.cartBridge(bearer(authorization), origin, body);
  }

  @Post('product-context')
  @HttpCode(200)
  productContext(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Headers('origin') origin: string | undefined) {
    return this.widget.productContext(bearer(authorization), origin, body);
  }

  @Post('cart/result')
  @HttpCode(200)
  cartResult(@Body() body: unknown, @Headers('authorization') authorization: string | undefined, @Headers('origin') origin: string | undefined) {
    return this.widget.cartBridge(bearer(authorization), origin, body, true);
  }
}

@Controller('api/website-ingestion')
@PublicRoute()
export class WebsiteIngestionController {
  constructor(private readonly service: WebsiteIntegrationService, private readonly widget: WidgetService) {}

  @Post('pages')
  @HttpCode(200)
  ingestPages(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    return this.service.ingestPages(bearer(authorization), body);
  }

  @Post('products')
  @HttpCode(200)
  ingestProducts(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    return this.service.ingestProducts(bearer(authorization), body);
  }

  @Post('batch')
  @HttpCode(200)
  ingestBatch(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    return this.service.ingestBatch(bearer(authorization), body);
  }

  @Post('page-view')
  @HttpCode(200)
  trackPageView(@Headers('authorization') authorization: string | undefined, @Headers('origin') origin: string | undefined, @Body() body: unknown) {
    return this.widget.trackWebsitePage(bearer(authorization), origin, body);
  }
}
