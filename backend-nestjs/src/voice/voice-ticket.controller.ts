import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { CurrentTenant, CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth-context';
import type { TenantContext } from '../common/tenant/tenant-context.store';
import { VoiceTicketService } from './voice-ticket.service';

@Controller('api/voice')
export class VoiceTicketController {
  constructor(private readonly tickets: VoiceTicketService) {}

  @Post('ticket')
  @HttpCode(200)
  @RequirePermission('conversations:write')
  issue(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Headers('origin') origin?: string,
  ) {
    return this.tickets.issue(user, tenant, origin);
  }
}
