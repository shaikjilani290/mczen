import { AgentExecutionContext } from '../../context/agent-execution-context.interface';

/**
 * Tool categories supported by the McZEN tool registry. New categories can be
 * added here without changing the registry mechanics.
 */
export type ToolCategory =
  | 'knowledge'
  | 'products'
  | 'orders'
  | 'customers'
  | 'payments'
  | 'communication'
  | 'school'
  | 'matrimonial'
  | 'custom';

/**
 * Tenant availability mode.
 * - `ALL_TENANTS`: the tool is available to every tenant.
 * - `RESTRICTED`: the tool is available only to tenants listed in
 *   `allowedTenants` (which must be non-empty when this mode is used).
 */
export type ToolTenantMode = 'ALL_TENANTS' | 'RESTRICTED';

/** A single input property, expressed as a JSON-Schema subset. */
export interface ToolInputProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  /** Allowed values (string properties only). */
  enum?: readonly string[];
  /** Maximum string length. Enforced by the validation service. */
  maxLength?: number;
  /** Minimum numeric value. Enforced by the validation service. */
  minimum?: number;
  /** Maximum numeric value. Enforced by the validation service. */
  maximum?: number;
  /** Item schema for array properties. Enforced by the validation service. */
  items?: ToolInputProperty;
  /**
   * Declared nested properties for object properties. When present, undeclared
   * nested properties are rejected. Enforced by the validation service.
   */
  properties?: Record<string, ToolInputProperty>;
}

/**
 * Tool input contract. The validation service (Phase 3) enforces this schema;
 * the `parameters` payload sent to Ollama is derived from it directly.
 */
export interface ToolInputSchema {
  type: 'object';
  required: string[];
  properties: Record<string, ToolInputProperty>;
  /** Always false: tool inputs never accept undeclared properties. */
  additionalProperties: false;
}

/**
 * Tool execution handler.
 *
 * Every handler receives the backend-established execution context (never a
 * model-supplied tenant id) and an AbortSignal so it can support cooperative
 * cancellation. Handlers must observe `signal.aborted` and stop long-running
 * work promptly; `Promise.race`-only timeouts are explicitly forbidden in the
 * interface docs.
 */
export type ToolHandler = (
  input: Record<string, unknown>,
  context: AgentExecutionContext,
  signal: AbortSignal,
  runtime?: ToolRuntimeConfiguration,
) => Promise<unknown>;

/** Tenant-bound values loaded at execution time; never serialized to clients or logs. */
export interface ToolRuntimeConfiguration {
  readonly config: Readonly<Record<string, unknown>>;
  readonly secrets: Readonly<Record<string, string>>;
}

/** Full tool definition registered in the registry. */
export interface ToolDefinition {
  /** Unique, stable tool name exposed to the AI model. */
  name: string;
  description: string;
  category: ToolCategory;
  /** Permission strings required before execution, e.g. `products:read`. */
  requiredPermissions: readonly string[];
  enabled: boolean;
  /** When true, execution requires explicit user confirmation first. */
  requiresConfirmation: boolean;
  /** Maximum execution time in milliseconds. */
  timeoutMs: number;
  tenantMode: ToolTenantMode;
  /** Required (non-empty) when `tenantMode` is `RESTRICTED`. */
  allowedTenants?: readonly string[];
  inputSchema: ToolInputSchema;
  /** Optional, code-owned schema for non-secret tenant configuration. */
  configurationSchema?: ToolInputSchema;
  handler: ToolHandler;
}

/**
 * Metadata-only view that is safe to expose through public endpoints.
 * Handlers and internal wiring are intentionally omitted.
 */
export interface ToolMetadata {
  name: string;
  description: string;
  category: ToolCategory;
  requiredPermissions: readonly string[];
  enabled: boolean;
  requiresConfirmation: boolean;
  inputSchema: ToolInputSchema;
}