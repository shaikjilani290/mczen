import { isUuidv7 } from '../../common/ids/uuid';

/**
 * Execution context established by the backend for every agent request.
 *
 * SECURITY: `tenantId` MUST be resolved from authenticated or verified request
 * metadata (verified JWT/session and DB membership) — NEVER from AI-generated
 * tool arguments or client tenant fields. Only the explicit non-production,
 * loopback demo exception may use the legacy development header.
 */
export interface AgentExecutionContext {
  /** Tenant the backend verified for this request. */
  tenantId: string;

  /** Optional authenticated user within the tenant. */
  userId?: string;

  /** Optional conversation the request belongs to. */
  conversationId?: string;

  /** Indicates transcript provenance without changing agent behavior. */
  modality?: 'text' | 'voice';

  /**
   * Set only by the widget service after it verified a signed widget session.
   * Marks an anonymous visitor whose conversation is a user-less widget conversation.
   */
  channel?: 'widget';

  /** Language detected or selected for this request, when known. */
  language?: 'en' | 'hi' | 'te';

  /** Optional assistant id set only by a backend-verified conversation/session. */
  assistantId?: string;

  /** Permission strings granted to the caller for this request. */
  permissions: readonly string[];

  /** Correlation id used for logs and audit records. */
  requestId: string;
}

/** Shape guard only, not authentication; provenance belongs to the resolver. */
export function isAgentExecutionContext(
  value: unknown,
): value is AgentExecutionContext {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const context = value as Partial<AgentExecutionContext>;

  return (
    typeof context.tenantId === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(context.tenantId) &&
    typeof context.requestId === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(context.requestId) &&
    Array.isArray(context.permissions) &&
    (context.assistantId === undefined || isUuidv7(context.assistantId)) &&
    (context.userId === undefined || isUuidv7(context.userId)) &&
    (context.conversationId === undefined || isUuidv7(context.conversationId)) &&
    (context.channel === undefined || context.channel === 'widget') &&
    (context.modality === undefined || context.modality === 'text' || context.modality === 'voice') &&
    (context.language === undefined || context.language === 'en' || context.language === 'hi' || context.language === 'te') &&
    context.permissions.length <= 1000 &&
    context.permissions.every(
      (permission: unknown) =>
        typeof permission === 'string' &&
        permission.length > 0 &&
        permission.length <= 128,
    )
  );
}
