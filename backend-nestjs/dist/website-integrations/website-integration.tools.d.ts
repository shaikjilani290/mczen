import type { ToolDefinition } from '../agent/tools/interfaces/tool-definition.interface';
import { WebsiteIntegrationRepository } from './website-integration.repository';
import type { MerchantCartService } from './merchant-cart.service';
export declare function createWebsiteIntegrationTools(repository: WebsiteIntegrationRepository, merchant?: MerchantCartService): ToolDefinition[];
