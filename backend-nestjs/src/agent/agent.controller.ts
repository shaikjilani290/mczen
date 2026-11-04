
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TenantContextService } from './context/tenant-context.service';
import { AllowDevHeader } from '../auth/auth.decorators';
import { AgentService } from './agent.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { parseAgentConversationId } from '../conversations/conversations.dto';

@Controller('api/agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('ask')
  @AllowDevHeader()
  async ask(
    @Body() body: unknown,
    @Res({ passthrough: true }) response?: Response,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some((key) => key !== 'question' && key !== 'conversationId')) {
      throw new BadRequestException('The request contains unsupported fields.');
    }
    const request = body as { question?: unknown; conversationId?: unknown };
    const question = typeof request.question === 'string' ? request.question.trim() : '';

    if (!question || question.length > 2000) {
      throw new BadRequestException(
        'Question must contain between 1 and 2000 characters.',
      );
    }

    // SECURITY: the tenant context is established by the backend from trusted
    // request metadata. It is NEVER taken from the request body or any
    // AI-generated content.
    const context = this.tenantContext.resolve();
    response?.setHeader('X-Request-Id', context.requestId);

    const conversationId = parseAgentConversationId(request.conversationId);
    return this.agent.ask(question, conversationId ? { ...context, conversationId } : context);
  }

  @Get('tools')
  @AllowDevHeader()
  async getTools(
    @Res({ passthrough: true }) response?: Response,
  ) {
    const context = this.tenantContext.resolve();
    response?.setHeader('X-Request-Id', context.requestId);

    return {
      success: true,
      tools: (await this.toolRegistry.listForTenantAtCallTime(context.tenantId, context.assistantId))
        .filter((tool) => tool.enabled),
    };
  }
}
