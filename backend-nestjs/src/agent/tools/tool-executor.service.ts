import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  type AgentExecutionContext,
  isAgentExecutionContext,
} from '../context/agent-execution-context.interface';
import type { ToolDefinition } from './interfaces/tool-definition.interface';
import { ToolRegistryService } from './tool-registry.service';
import { ToolPermissionService } from './tool-permission.service';
import { ToolValidationService } from './tool-validation.service';
import {
  ToolAuditOutcome,
  ToolAuditService,
} from './tool-audit.service';
import {
  ToolErrorCode,
  ToolExecutionResult,
} from './interfaces/tool-execution-result.interface';

export interface ToolExecutionOptions {
  /** Optional runtime allowlist; backend-controlled knowledge calls omit it. */
  readonly allowedToolNames?: ReadonlySet<string>;
}

/**
 * Executes tools with the full security lifecycle, in this exact order:
 *
 *  1. Resolve tenant context      (required parameter — guarded, never
 *                                  taken from model output)
 *  2. Find registered tool        (unknown tools never execute)
 *  3. Verify tenant availability  (per-tenant tool access)
 *  4. Check enabled status        (disabled tools never execute)
 *  5. Check required permissions  (caller permission strings)
 *  6. Validate input              (strict schema + size limits)
 *  7. Execute with timeout and    (cooperative AbortSignal cancellation)
 *     AbortSignal
 *  8. Capture result or safe error
 *  9. Record audit metadata
 * 10. Return a structured result  (never throws for expected failures)
 *
 * Any failed check aborts BEFORE the handler runs, returning `ok: false`
 * with a safe error code.
 */
@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly permissions: ToolPermissionService,
    private readonly validation: ToolValidationService,
    private readonly audit: ToolAuditService,
  ) {}

  /**
   * Executes a tool under the full security lifecycle.
   *
   * @param toolName tool name resolved from the MODEL, but always re-verified
   *                 against the registry here
   * @param input    raw model-generated arguments (untrusted)
   * @param context  backend-established execution context (required)
   * @param signal   optional external cancellation signal (e.g. request abort)
   */
  async execute(
    toolName: unknown,
    input: unknown,
    context: AgentExecutionContext,
    signal?: AbortSignal,
    options?: ToolExecutionOptions,
  ): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const name =
      typeof toolName === 'string' &&
      /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(toolName)
        ? toolName
        : undefined;
    const argumentsSummary = {
      keys: input && typeof input === 'object' && !Array.isArray(input)
        ? Object.keys(input).filter((key) => !/(secret|password|token|credential|api.?key|authorization|private.?key)/i.test(key)).sort().slice(0, 30)
        : [],
    };
    const serializedSummary = JSON.stringify(argumentsSummary);
    const argumentsDigest = createHash('sha256').update(serializedSummary).digest('hex');
    const finish = async (
      outcome: ToolAuditOutcome,
      errorCode: ToolErrorCode | null,
      resultSummary?: Record<string, number | boolean>,
    ): Promise<void> => {
      if (context.modality === 'voice') this.logger.log({
        event: 'voice_tool_timing', requestId: context.requestId, toolName: name ?? 'invalid_tool',
        durationMs: Date.now() - startedAt, outcome, errorCode,
      });
      await this.audit.record({
        tenantId: context.tenantId,
        toolName: name ?? 'invalid_tool',
        requestId: context.requestId,
        executedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        outcome,
        errorCode,
        assistantId: context.assistantId,
        conversationId: context.conversationId,
        userId: context.userId,
        argumentsDigest,
        argumentsSize: Math.min(serializedSummary.length, 65535),
        argumentsSummary,
        resultSummary,
      });
    };

    // 1. Tenant context guard: the context must be backend-established.
    if (!isAgentExecutionContext(context)) {
      return {
        ok: false,
        error: {
          code: 'MISSING_CONTEXT',
          message: 'Tool execution requires a verified tenant context.',
        },
      };
    }

    if (!name) {
      await finish('rejected', 'INVALID_TOOL_NAME');
      return {
        ok: false,
        error: {
          code: 'INVALID_TOOL_NAME',
          message: 'The requested tool name is invalid.',
        },
      };
    }

    // 2. Resolve the tool from the registry.
    const tool = this.toolRegistry.getTool(name);

    if (!tool) {
      await finish('rejected', 'TOOL_NOT_FOUND');
      return {
        ok: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: 'The requested tool is not registered.',
        },
      };
    }

    // 3. Tenant availability check.
    let settings;
    try {
      settings = await this.toolRegistry.executionSettings(name, context.tenantId, tool, context.assistantId);
    } catch {
      await finish('failed', 'EXECUTION_ERROR');
      return {
        ok: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: 'Tool configuration could not be loaded.',
        },
      };
    }
    if (!settings.available) {
      await finish('rejected', 'TENANT_NOT_ALLOWED');
      return {
        ok: false,
        error: {
          code: 'TENANT_NOT_ALLOWED',
          message: 'The requested tool is not available to this tenant.',
        },
      };
    }

    // 4. Enabled check.
    if (!tool.enabled || !settings.enabled) {
      await finish('rejected', 'TOOL_DISABLED');
      return {
        ok: false,
        error: {
          code: 'TOOL_DISABLED',
          message: 'The requested tool is disabled.',
        },
      };
    }

    // 5. Permission check.
    if (!this.permissions.hasPermissions(context.permissions, settings.requiredPermissions)) {
      await finish('rejected', 'PERMISSION_DENIED');
      return {
        ok: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'The required tool permissions are missing.',
        },
      };
    }

    // There is no confirmation workflow yet: confirmation-required tools
    // must fail closed rather than being runnable by a model.
    if (settings.requiresConfirmation) {
      await finish('rejected', 'CONFIRMATION_REQUIRED');
      return {
        ok: false,
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message: 'This tool requires explicit user confirmation.',
        },
      };
    }

    if (options?.allowedToolNames && !options.allowedToolNames.has(name)) {
      await finish('rejected', 'TOOL_NOT_OFFERED');
      return {
        ok: false,
        error: {
          code: 'TOOL_NOT_OFFERED',
          message: 'The requested tool is not available for this conversation.',
        },
      };
    }

    // 6. Input validation (strict, size-limited, rejects undeclared keys).
    let validatedInput: Record<string, unknown>;

    try {
      validatedInput = this.validation.validateToolInput(name, input, tool.inputSchema);
    } catch {
      await finish('rejected', 'INVALID_INPUT');
      return {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'The requested tool received invalid input.',
        },
      };
    }

    // 7. Execute with cooperative cancellation + timeout.
    let secrets: Record<string, string>;
    try {
      secrets = await this.toolRegistry.executionSecrets(name, context.tenantId);
    } catch {
      await finish('failed', 'EXECUTION_ERROR');
      return {
        ok: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: 'Tool credentials could not be loaded.',
        },
      };
    }

    return this.runHandler(
      tool,
      validatedInput,
      context,
      signal,
      finish,
      { config: settings.config, secrets },
      settings.timeoutMs,
    );
  }

  /**
   * Runs the handler with a composed AbortSignal covering both the tool
   * timeout and any external caller cancellation.
   *
   * Cancellation model:
   * - The HANDLER receives the composed signal and is expected to observe it
   *   (cooperative cancellation — the only way to actually stop work).
   * - The watchdog race below exists ONLY as a safety net so the executor
   *   itself always returns promptly; it does NOT cancel the underlying
   *   operation (which is impossible for a promise in JavaScript).
   */
  private async runHandler(
    tool: ToolDefinition,
    validatedInput: Record<string, unknown>,
    context: AgentExecutionContext,
    externalSignal: AbortSignal | undefined,
    finish: (
      outcome: ToolAuditOutcome,
      errorCode: ToolErrorCode | null,
      resultSummary?: Record<string, number | boolean>,
    ) => Promise<void>,
    runtime: { config: Readonly<Record<string, unknown>>; secrets: Readonly<Record<string, string>> },
    timeoutMs: number,
  ): Promise<ToolExecutionResult> {
    if (externalSignal?.aborted) {
      await finish('failed', 'CANCELLED');
      return {
        ok: false,
        error: { code: 'CANCELLED', message: 'Tool execution was cancelled.' },
      };
    }

    const controller = new AbortController();
    let stopCode: 'TIMEOUT' | 'CANCELLED' | undefined;
    let stop: (code: 'TIMEOUT' | 'CANCELLED') => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = (code) => {
        if (stopCode) return;
        stopCode = code;
        // Reject the wait AND signal the handler; a race alone cannot cancel it.
        reject(new Error('Tool execution stopped.'));
        controller.abort();
      };
    });
    const onExternalAbort = () => stop('CANCELLED');
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);

    try {
      const data = await Promise.race([
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return tool.handler(validatedInput, context, controller.signal, runtime);
        }),
        stopped,
      ]);

      // 8. Result captured. 9. Audit. 10. Structured success.
      await finish('succeeded', null, summarizeResult(data));
      return { ok: true, data };
    } catch {
      // Handler threw. Distinguish cancellation from execution errors.
      if (stopCode === 'CANCELLED') {
        await finish('failed', 'CANCELLED');
        return {
          ok: false,
          error: { code: 'CANCELLED', message: 'Tool execution was cancelled.' },
        };
      }

      if (stopCode === 'TIMEOUT') {
        await finish('timed_out', 'TIMEOUT');
        return {
          ok: false,
          error: { code: 'TIMEOUT', message: 'Tool execution timed out.' },
        };
      }

      await finish('failed', 'EXECUTION_ERROR');
      return {
        ok: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: 'The requested tool could not complete the request.',
        },
      };
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

function summarizeResult(value: unknown): Record<string, number | boolean> {
  if (Array.isArray(value)) return { resultCount: value.length };
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const summary: Record<string, number | boolean> = {};
  for (const key of ['count', 'resultCount', 'total', 'found', 'matched']) {
    const candidate = source[key];
    if (typeof candidate === 'number' || typeof candidate === 'boolean') {
      summary[key] = candidate;
    }
  }
  return summary;
}
