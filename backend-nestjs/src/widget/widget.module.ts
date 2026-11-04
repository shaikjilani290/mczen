import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { VoiceModule } from '../voice/voice.module';
import { PlatformController, WidgetAdminController, WidgetPublicController } from './widget.controllers';
import { WidgetRepository } from './widget.repository';
import { WidgetService } from './widget.service';

@Module({
  imports: [AgentModule, VoiceModule],
  controllers: [WidgetAdminController, WidgetPublicController, PlatformController],
  providers: [WidgetRepository, WidgetService],
})
export class WidgetModule {}
