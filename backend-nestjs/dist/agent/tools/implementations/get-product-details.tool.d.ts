import { DemoProduct } from './demo-catalogues';
import { ToolDefinition } from '../interfaces/tool-definition.interface';
export declare function createGetProductDetailsTool(catalogues: Readonly<Record<string, readonly DemoProduct[]>>): ToolDefinition;
