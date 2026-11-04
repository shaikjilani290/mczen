import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsRepository, TOOL_AUDIT_SINK } from './conversations.repository';
import { ConversationsService } from './conversations.service';

@Module({
  controllers: [ConversationsController],
  providers: [
    ConversationsRepository,
    ConversationsService,
    { provide: TOOL_AUDIT_SINK, useExisting: ConversationsService },
  ],
  exports: [ConversationsService, TOOL_AUDIT_SINK],
})
export class ConversationsModule {}
