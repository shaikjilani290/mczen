import { Module } from '@nestjs/common';
import { WebsiteIntegrationRepository } from './website-integration.repository';
import { MerchantCartService } from './merchant-cart.service';
import { SharedStateModule } from '../shared-state/shared-state.module';
import { ProductIdentityService } from './product-identity.service';

@Module({
  imports: [SharedStateModule],
  providers: [WebsiteIntegrationRepository, MerchantCartService, ProductIdentityService],
  exports: [WebsiteIntegrationRepository, MerchantCartService, ProductIdentityService],
})
export class WebsiteDataModule {}
