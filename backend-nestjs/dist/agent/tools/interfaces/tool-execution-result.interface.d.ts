export type ToolErrorCode = 'MISSING_CONTEXT' | 'INVALID_TOOL_NAME' | 'TOOL_NOT_FOUND' | 'TOOL_NOT_OFFERED' | 'TENANT_NOT_ALLOWED' | 'TOOL_DISABLED' | 'PERMISSION_DENIED' | 'CONFIRMATION_REQUIRED' | 'INVALID_INPUT' | 'TIMEOUT' | 'CANCELLED' | 'EXECUTION_ERROR';
export interface ToolExecutionError {
    code: ToolErrorCode;
    message: string;
}
export type ToolExecutionResult<T = unknown> = {
    ok: true;
    data: T;
} | {
    ok: false;
    error: ToolExecutionError;
};
