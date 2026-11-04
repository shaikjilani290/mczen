import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Put } from '@nestjs/common';
import { Audited } from '../audit/audit.interceptor';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth-context';
import { ToolsService } from './tools.service';
import { parseAssistantToolUpdate, parseTenantToolUpdate, parseToolSecret, validateToolReference } from './tools.dto';

@Controller('api/tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  @RequirePermission('tools:read')
  list() { return this.tools.list(); }

  @Get(':toolName/tenant-secret')
  @RequirePermission('tools:read')
  secretStatus(@Param('toolName') name: string) {
    return this.tools.secretStatus(validateToolReference(name));
  }

  @Put(':toolName/tenant-secret')
  @Audited({ action: 'tool.secret.set', resourceType: 'tool', idParam: 'toolName' })
  @RequirePermission('tools:write')
  setSecret(@CurrentUser() user: AuthenticatedUser, @Param('toolName') name: string, @Body() body: unknown) {
    const input = parseToolSecret(body);
    return this.tools.setSecret(validateToolReference(name), input.value, input.expiresAt, user);
  }

  @Delete(':toolName/tenant-secret')
  @Audited({ action: 'tool.secret.clear', resourceType: 'tool', idParam: 'toolName' })
  @HttpCode(200)
  @RequirePermission('tools:write')
  clearSecret(@Param('toolName') name: string) {
    return this.tools.clearSecret(validateToolReference(name));
  }

  @Get(':toolName')
  @RequirePermission('tools:read')
  get(@Param('toolName') name: string) {
    return this.tools.get(validateToolReference(name));
  }

  @Patch(':toolName/tenant-config')
  @Audited({ action: 'tool.config.update', resourceType: 'tool', idParam: 'toolName', valueFields: ['enabled'] })
  @RequirePermission('tools:write')
  update(@CurrentUser() user: AuthenticatedUser, @Param('toolName') name: string, @Body() body: unknown) {
    return this.tools.update(validateToolReference(name), parseTenantToolUpdate(body), user);
  }

  @Put(':toolName/assistants/:assistantId')
  @Audited({ action: 'tool.assistant.update', resourceType: 'tool', idParam: 'toolName', paramFields: ['assistantId'], valueFields: ['enabled'] })
  @RequirePermission('tools:write')
  updateAssistant(@Param('toolName') name: string, @Param('assistantId') assistantId: string, @Body() body: unknown) {
    return this.tools.updateAssistant(validateToolReference(name), assistantId, parseAssistantToolUpdate(body));
  }
}
