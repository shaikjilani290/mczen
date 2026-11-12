import { Module } from '@nestjs/common';
import { WebsiteIntegrationRepository } from './website-integration.repository';
import { MerchantCartService } from './merchant-cart.service';
import { SharedStateModule } from '../shared-state/shared-state.module';
import { ProductIdentityService } from './product-identity.service';
import { WebsiteKnowledgeEngine } from './website-knowledge.engine';

@Module({
  imports: [SharedStateModule],
  providers: [WebsiteIntegrationRepository, MerchantCartService, ProductIdentityService, WebsiteKnowledgeEngine],
  exports: [WebsiteIntegrationRepository, MerchantCartService, ProductIdentityService, WebsiteKnowledgeEngine],
})
export class WebsiteDataModule {}
