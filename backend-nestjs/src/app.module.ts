import { Module } from '@nestjs/common';
import { ReadinessController } from './health/readiness.controller';
import { AuditModule } from './audit/audit.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentModule } from './agent/agent.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AssistantsModule } from './assistants/assistants.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { VoiceModule } from './voice/voice.module';
import { WidgetModule } from './widget/widget.module';
import { SharedStateModule } from './shared-state/shared-state.module';
import { WebsiteIntegrationsModule } from './website-integrations/website-integrations.module';

@Module({
  // AuthModule installs the global, fail-closed guard/context/filter pipeline.
  imports: [SharedStateModule, AuditModule, DatabaseModule.forRoot(), AgentModule, AuthModule, AssistantsModule, KnowledgeModule, VoiceModule, WidgetModule, WebsiteIntegrationsModule],
  controllers: [AppController, ReadinessController],
  providers: [AppService],
})
export class AppModule {}
