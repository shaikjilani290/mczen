/**
 * Machine-readable error codes returned by the tool execution lifecycle.
 * These codes are safe to expose to the AI model and to clients — they never
 * include stack traces, internal messages, or argument contents.
 */
export type ToolErrorCode =
  | 'MISSING_CONTEXT'
  | 'INVALID_TOOL_NAME'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_NOT_OFFERED'
  | 'TENANT_NOT_ALLOWED'
  | 'TOOL_DISABLED'
  | 'PERMISSION_DENIED'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_INPUT'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'EXECUTION_ERROR';

/** A safe, structured execution error. */
export interface ToolExecutionError {
  code: ToolErrorCode;
  /** Human-readable, non-sensitive message. */
  message: string;
}

/**
 * Structured result of a tool execution attempt. The executor NEVER throws for
 * security/validation/execution failures — it returns `ok: false` so callers
 * (e.g. the Ollama agent loop) can feed a safe error back to the model.
 */
export type ToolExecutionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ToolExecutionError };
