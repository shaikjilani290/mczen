import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeService } from '../agent/knowledge.service';
import { ToolPermissionService } from '../agent/tools/tool-permission.service';
import { ToolRegistryService } from '../agent/tools/tool-registry.service';
import { ToolValidationService } from '../agent/tools/tool-validation.service';
import { ToolConfigurationRepository } from './tool-configuration.repository';
import { ToolSecretCipher } from './tool-secret-cipher';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';
import { WebsiteDataModule } from '../website-integrations/website-data.module';

@Module({
  imports: [KnowledgeModule, WebsiteDataModule],
  controllers: [ToolsController],
  providers: [
    KnowledgeService,
    ToolRegistryService,
    ToolPermissionService,
    ToolValidationService,
    ToolConfigurationRepository,
    ToolSecretCipher,
    ToolsService,
  ],
  exports: [
    KnowledgeService,
    ToolRegistryService,
    ToolPermissionService,
    ToolValidationService,
    ToolConfigurationRepository,
    ToolSecretCipher,
  ],
})
export class ToolsModule {}
