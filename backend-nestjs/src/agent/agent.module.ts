
import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentRuntimeConfigService } from './config/agent-runtime-config.service';
import { TenantContextService } from './context/tenant-context.service';
import { ToolAuditService } from './tools/tool-audit.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { ToolsModule } from '../tools/tools.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [ToolsModule, ConversationsModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentRuntimeConfigService,
    TenantContextService,
    ToolExecutorService,
    ToolAuditService,
  ],
  exports: [AgentService, TenantContextService],
})
export class AgentModule {}
