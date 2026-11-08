import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth-context';
import {
  parseConversationQuery,
  parseCreateConversation,
  parseTranscriptQuery,
  parseUpdateConversation,
} from './conversations.dto';
import { ConversationsService } from './conversations.service';

@Controller('api/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post()
  @RequirePermission('conversations:write')
  create(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.conversations
      .create({ ...parseCreateConversation(body), userId: user.userId })
      .then((id) => ({ id }));
  }

  @Get()
  @RequirePermission('conversations:read')
  list(@Query() query: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.conversations.list({
      ...parseConversationQuery(query),
      userId: user.userId,
      elevated: false,
    });
  }

  @Get(':id')
  @RequirePermission('conversations:read')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.conversations.get(id, user);
  }

  @Patch(':id')
  @RequirePermission('conversations:write')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.conversations.update(id, parseUpdateConversation(body), user);
  }

  @Post(':id/archive')
  @RequirePermission('conversations:write')
  async archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.conversations.archive(id, user);
    return { success: true };
  }

  @Get(':id/messages')
  @RequirePermission('conversations:read')
  transcript(
    @Param('id') id: string,
    @Query() query: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversations.transcript(id, parseTranscriptQuery(query), user);
  }

  @Get(':id/messages/:messageId/tool-calls')
  @RequirePermission('conversations:read')
  toolCalls(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversations.toolCalls(id, messageId, user);
  }
}
