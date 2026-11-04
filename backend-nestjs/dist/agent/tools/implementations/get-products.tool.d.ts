import { DemoProduct } from './demo-catalogues';
import { ToolDefinition } from '../interfaces/tool-definition.interface';
export declare function createGetProductsTool(catalogues: Readonly<Record<string, readonly DemoProduct[]>>): ToolDefinition;
