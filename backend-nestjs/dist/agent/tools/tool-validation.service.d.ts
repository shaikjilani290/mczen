import { ToolInputSchema } from './interfaces/tool-definition.interface';
export declare class ToolValidationService {
    validateToolInput(toolName: string, input: unknown, schema: ToolInputSchema): Record<string, unknown>;
    private validateProperty;
    private validateString;
    private validateNumber;
    private validateArray;
    private validateObject;
    private invalid;
}
