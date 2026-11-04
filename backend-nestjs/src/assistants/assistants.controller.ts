import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Patch } from '@nestjs/common';
import { Audited } from '../audit/audit.interceptor';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth-context';
import { AssistantsService } from './assistants.service';
import { parseCreateAssistant, parseInstructions, parseSecretInput, parseSecretKind, parseUpdateAssistant } from './assistants.dto';

/**
 * Tenant-admin assistant configuration. The tenant always comes from the
 * verified context (guard + ALS); route ids are looked up within that tenant,
 * so foreign ids return 404. Bodies never carry a tenant id (unknown keys are
 * rejected) and responses never include provider secrets.
 */
@Controller('api/assistants')
export class AssistantsController {
  constructor(private readonly assistants: AssistantsService) {}

  @Get('options')
  @RequirePermission('assistants:read')
  options() { return this.assistants.options(); }

  @Get()
  @RequirePermission('assistants:read')
  list() { return this.assistants.list(); }

  @Post()
  @Audited({ action: 'assistant.create', resourceType: 'assistant' })
  @RequirePermission('assistants:write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.assistants.create(parseCreateAssistant(body), user.userId);
  }

  @Get(':id')
  @RequirePermission('assistants:read')
  get(@Param('id') id: string) { return this.assistants.get(id); }

  @Patch(':id')
  @Audited({ action: 'assistant.update', resourceType: 'assistant', idParam: 'id' })
  @RequirePermission('assistants:write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.assistants.update(id, parseUpdateAssistant(body), user.userId);
  }

  @Get(':id/instructions')
  @RequirePermission('assistants:read')
  instructions(@Param('id') id: string) { return this.assistants.instructionHistory(id); }

  @Put(':id/instructions')
  @Audited({ action: 'assistant.instructions.update', resourceType: 'assistant', idParam: 'id' })
  @RequirePermission('assistants:write')
  setInstructions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.assistants.setInstructions(id, parseInstructions(body), user.userId);
  }

  @Put(':id/secrets/:kind')
  @Audited({ action: 'assistant.secret.set', resourceType: 'assistant', idParam: 'id', paramFields: ['kind'] })
  @RequirePermission('assistants:write')
  setSecret(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('kind') kind: string, @Body() body: unknown) {
    return this.assistants.setSecret(id, parseSecretKind(kind), parseSecretInput(body), user.userId);
  }

  @Delete(':id/secrets/:kind')
  @Audited({ action: 'assistant.secret.clear', resourceType: 'assistant', idParam: 'id', paramFields: ['kind'] })
  @HttpCode(200)
  @RequirePermission('assistants:write')
  clearSecret(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('kind') kind: string) {
    return this.assistants.clearSecret(id, parseSecretKind(kind), user.userId);
  }

  @Get(':id/audit')
  @RequirePermission('assistants:read')
  audit(@Param('id') id: string) { return this.assistants.audit(id); }
}
