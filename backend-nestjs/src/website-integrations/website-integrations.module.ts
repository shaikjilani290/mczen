import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { SharedStateModule } from '../shared-state/shared-state.module';
import { WidgetModule } from '../widget/widget.module';
import { ToolsModule } from '../tools/tools.module';
import { WebsiteDataModule } from './website-data.module';
import {
  WebsiteIngestionController,
  WebsiteIntegrationAdminController,
  WebsiteIntegrationPublicController,
} from './website-integration.controllers';
import { WebsiteIntegrationService } from './website-integration.service';

@Module({
  imports: [WebsiteDataModule, KnowledgeModule, SharedStateModule, WidgetModule, ToolsModule],
  controllers: [
    WebsiteIntegrationAdminController,
    WebsiteIntegrationPublicController,
    WebsiteIngestionController,
  ],
  providers: [WebsiteIntegrationService],
  exports: [WebsiteIntegrationService],
})
export class WebsiteIntegrationsModule {}
