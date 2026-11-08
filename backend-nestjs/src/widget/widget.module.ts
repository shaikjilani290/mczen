import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { VoiceModule } from '../voice/voice.module';
import { PlatformController, WidgetAdminController, WidgetPublicController } from './widget.controllers';
import { WidgetRepository } from './widget.repository';
import { WidgetService } from './widget.service';
import { WebsiteDataModule } from '../website-integrations/website-data.module';

@Module({
  imports: [AgentModule, VoiceModule, WebsiteDataModule],
  controllers: [WidgetAdminController, WidgetPublicController, PlatformController],
  providers: [WidgetRepository, WidgetService],
  exports: [WidgetService],
})
export class WidgetModule {}
