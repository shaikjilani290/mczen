import type { ToolDefinition } from '../agent/tools/interfaces/tool-definition.interface';
import { MerchantCartService } from './merchant-cart.service';
export declare function createMerchantCartTools(cart: MerchantCartService): ToolDefinition[];
