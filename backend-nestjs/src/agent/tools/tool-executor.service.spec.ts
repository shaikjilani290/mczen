import { KnowledgeService } from '../knowledge.service';
import type { AgentExecutionContext } from '../context/agent-execution-context.interface';
import { ToolAuditService } from './tool-audit.service';
import { ToolExecutorService } from './tool-executor.service';
import { ToolPermissionService } from './tool-permission.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolValidationService } from './tool-validation.service';
import { ToolDefinition } from './interfaces/tool-definition.interface';

function createContext(
  tenantId: string,
  permissions: string[] = ['knowledge:read'],
): AgentExecutionContext {
  return {
    tenantId,
    permissions,
    requestId: `req-${tenantId}-test`,
  };
}

function createTestTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'Test tool used by the executor spec.',
    category: 'custom',
    requiredPermissions: [],
    enabled: true,
    requiresConfirmation: false,
    timeoutMs: 1000,
    tenantMode: 'ALL_TENANTS',
    inputSchema: {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: {},
    },
    handler: async (input, context) => ({ tenantId: context.tenantId, echo: input }),
    ...overrides,
  };
}

describe('ToolExecutorService', () => {
  let registry: ToolRegistryService;
  let audit: ToolAuditService;
  let executor: ToolExecutorService;

  beforeEach(async () => {
    registry = new ToolRegistryService(new KnowledgeService());
    await registry.onModuleInit();
    audit = new ToolAuditService();
    executor = new ToolExecutorService(
      registry,
      new ToolPermissionService(),
      new ToolValidationService(),
      audit,
    );
  });

  it('executes a tool successfully (test 7)', async () => {
    registry.register(createTestTool({ name: 'ok_tool' }));

    const result = await executor.execute(
      'ok_tool',
      {},
      createContext('tenant-a'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { tenantId: string }).tenantId).toBe('tenant-a');
    }
  });

  it('passes current tenant configuration to the handler at execution time', async () => {
    const handler = jest.fn(async (_input, _context, _signal, runtime) => ({
      category: runtime.config.defaultCategory,
    }));
    registry.register(createTestTool({ name: 'configured_tool', handler }));
    jest.spyOn(registry, 'executionSettings').mockResolvedValue({
      available: true,
      enabled: true,
      requiredPermissions: [],
      config: { defaultCategory: 'books' },
      secrets: {},
      timeoutMs: 1000,
      requiresConfirmation: false,
    });

    const result = await executor.execute('configured_tool', {}, createContext('tenant-a'));

    expect(result).toEqual({ ok: true, data: { category: 'books' } });
    expect(handler).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ tenantId: 'tenant-a' }),
      expect.any(AbortSignal),
      { config: { defaultCategory: 'books' }, secrets: {} },
    );
  });

  it('rejects unknown tools (test 3)', async () => {
    const result = await executor.execute(
      'does_not_exist',
      {},
      createContext('tenant-a'),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'TOOL_NOT_FOUND' },
    });
  });

  it('rejects disabled tools (test 4)', async () => {
    registry.register(createTestTool({ name: 'off_tool', enabled: false }));

    const result = await executor.execute(
      'off_tool',
      {},
      createContext('tenant-a'),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'TOOL_DISABLED' },
    });
  });

  it('rejects execution without required permissions (test 5)', async () => {
    registry.register(
      createTestTool({
        name: 'admin_tool',
        requiredPermissions: ['admin:secrets'],
      }),
    );

    const result = await executor.execute(
      'admin_tool',
      {},
      createContext('tenant-a', ['knowledge:read']),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
  });

  it('allows execution when all required permissions are held (test 5b)', async () => {
    registry.register(
      createTestTool({
        name: 'reader_tool',
        requiredPermissions: ['knowledge:read'],
      }),
    );

    const result = await executor.execute(
      'reader_tool',
      {},
      createContext('tenant-a', ['knowledge:read']),
    );

    expect(result.ok).toBe(true);
  });

  it('blocks a tenant from executing another tenant\'s restricted tool (test 8)', async () => {
    registry.register(
      createTestTool({
        name: 'school_only',
        tenantMode: 'RESTRICTED',
        allowedTenants: ['tenant-b'],
        requiredPermissions: ['school:read'],
      }),
    );

    const tenantAResult = await executor.execute(
      'school_only',
      {},
      createContext('tenant-a', ['school:read']),
    );
    const tenantBResult = await executor.execute(
      'school_only',
      {},
      createContext('tenant-b', ['school:read']),
    );

    expect(tenantAResult).toMatchObject({
      ok: false,
      error: { code: 'TENANT_NOT_ALLOWED' },
    });
    expect(tenantBResult.ok).toBe(true);
  });

  it('isolates data per tenant and never trusts a tenantId in the input (test 9)', async () => {
    // The handler derives data from the CONTEXT tenant only.
    registry.register(
      createTestTool({
        name: 'tenant_data',
        handler: async (input, context) => ({
          tenantId: context.tenantId,
          rows: [`row-for-${context.tenantId}`],
        }),
      }),
    );

    // Attempt 1: tenant-a context.
    const tenantAResult = await executor.execute(
      'tenant_data',
      {},
      createContext('tenant-a'),
    );
    // Attempt 2: tenant-b context.
    const tenantBResult = await executor.execute(
      'tenant_data',
      {},
      createContext('tenant-b'),
    );
    // Attempt 3: tenant-a context but the INPUT tries to claim tenant-b
    // (a model-injected tenantId must have no effect).
    const spoofedResult = await executor.execute(
      'tenant_data',
      { tenantId: 'tenant-b' },
      createContext('tenant-a'),
    );

    expect(tenantAResult).toMatchObject({ ok: true, data: { tenantId: 'tenant-a' } });
    expect(tenantBResult).toMatchObject({ ok: true, data: { tenantId: 'tenant-b' } });
    // The spoofed input is rejected outright: `tenantId` is not a declared
    // input property, so the executor refuses the call entirely.
    expect(spoofedResult).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('times out long-running tools cooperatively (test 10)', async () => {
    registry.register(
      createTestTool({
        name: 'slow_tool',
        timeoutMs: 60,
        // The handler observes its AbortSignal — cooperative cancellation.
        handler: async (_input, _context, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      }),
    );

    const started = Date.now();
    const result = await executor.execute(
      'slow_tool',
      {},
      createContext('tenant-a'),
    );
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT' },
    });
    // The executor must not wait for the handler's full sleep.
    expect(elapsed).toBeLessThan(2000);
  });

  it('returns TIMEOUT when a handler ignores its AbortSignal (watchdog, test 10b)', async () => {
    registry.register(
      createTestTool({
        name: 'ignorant_tool',
        timeoutMs: 60,
        // Ignores the signal entirely — the watchdog safety net must still
        // return a structured TIMEOUT result promptly.
        handler: async () => new Promise(() => undefined),
      }),
    );

    const started = Date.now();
    const result = await executor.execute(
      'ignorant_tool',
      {},
      createContext('tenant-a'),
    );
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
    expect(elapsed).toBeLessThan(2000);
  });

  it('reports cancellation when the external signal aborts (test 10c)', async () => {
    const external = new AbortController();

    registry.register(
      createTestTool({
        name: 'cancellable_tool',
        handler: async (_input, _context, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      }),
    );

    const pending = executor.execute(
      'cancellable_tool',
      {},
      createContext('tenant-a'),
      external.signal,
    );

    external.abort();

    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('returns safe errors and never leaks internals (test 11)', async () => {
    registry.register(
      createTestTool({
        name: 'broken_tool',
        handler: async () => {
          throw new Error('SECRET_DB_CONNECTION_PASSWORD=hunter2');
        },
      }),
    );

    const result = await executor.execute(
      'broken_tool',
      {},
      createContext('tenant-a'),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'EXECUTION_ERROR' } });

    if (!result.ok) {
      // The safe message must not include the underlying error text.
      expect(result.error.message).not.toContain('SECRET');
      expect(result.error.message).not.toContain('hunter2');
    }
  });

  it('maps invalid input to a structured INVALID_INPUT result (test 6 via executor)', async () => {
    registry.register(
      createTestTool({
        name: 'strict_tool',
        inputSchema: {
          type: 'object',
          required: ['query'],
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'Search query', maxLength: 100 },
          },
        },
        handler: async () => ({}),
      }),
    );

    const missingRequired = await executor.execute(
      'strict_tool',
      {},
      createContext('tenant-a'),
    );
    const unexpectedProperty = await executor.execute(
      'strict_tool',
      { query: 'ok', evil: true },
      createContext('tenant-a'),
    );
    const wrongType = await executor.execute(
      'strict_tool',
      { query: 123 },
      createContext('tenant-a'),
    );

    expect(missingRequired).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(unexpectedProperty).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(wrongType).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('rejects a missing tenant context before anything executes (test 12a)', async () => {
    const result = await executor.execute(
      'knowledge_search',
      { query: 'test' },
      undefined as unknown as AgentExecutionContext,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'MISSING_CONTEXT' },
    });
    // Nothing may be audited as a tenant execution.
    expect(audit.list()).toHaveLength(0);
  });

  it('keeps knowledge_search working through the secure lifecycle (test 13)', async () => {
    const result = await executor.execute(
      'knowledge_search',
      { query: 'earning plan benefits' },
      createContext('tenant-a'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const documents = result.data as Array<{ id: string; source: string }>;
      expect(documents.length).toBeGreaterThan(0);
      expect(documents[0]?.id).toBe('plan-001');
    }
  });

  it('records audit metadata with safe error codes only', async () => {
    registry.register(createTestTool({ name: 'audited_tool' }));

    await executor.execute('audited_tool', {}, createContext('tenant-a'));
    await executor.execute('nope', {}, createContext('tenant-a'));

    const records = audit.list();
    expect(records).toHaveLength(2);

    const success = records[0];
    const rejection = records[1];

    expect(success).toMatchObject({
      tenantId: 'tenant-a',
      toolName: 'audited_tool',
      outcome: 'succeeded',
      errorCode: null,
    });
    expect(rejection).toMatchObject({
      tenantId: 'tenant-a',
      toolName: 'nope',
      outcome: 'rejected',
      errorCode: 'TOOL_NOT_FOUND',
    });

    for (const record of records) {
      const keys = Object.keys(record).sort();
      expect(keys).toEqual([
        'argumentsDigest',
        'argumentsSize',
        'argumentsSummary',
        'assistantId',
        'conversationId',
        'durationMs',
        'errorCode',
        'executedAt',
        'outcome',
        'requestId',
        'resultSummary',
        'tenantId',
        'toolName',
        'userId',
      ]);
      // No arguments, results, or secrets are ever recorded.
      expect(JSON.stringify(record)).not.toContain('query');
    }
  });

  it('does not invoke a handler when the caller signal is already aborted', async () => {
    const handler = jest.fn(async () => ({}));
    registry.register(createTestTool({ handler }));
    const caller = new AbortController();
    caller.abort();

    const result = await executor.execute('test_tool', {}, createContext('tenant-a'), caller.signal);

    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(handler).not.toHaveBeenCalled();
    expect(audit.list()).toHaveLength(1);
  });

  it('returns CANCELLED even if an active handler ignores cancellation', async () => {
    let signal: AbortSignal | undefined;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    registry.register(createTestTool({ handler: async (_input, _context, handlerSignal) => {
      signal = handlerSignal;
      entered();
      return new Promise(() => undefined);
    } }));
    const caller = new AbortController();
    const removeListener = jest.spyOn(caller.signal, 'removeEventListener');
    const pending = executor.execute('test_tool', {}, createContext('tenant-a'), caller.signal);
    await started;
    caller.abort();

    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(signal?.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(audit.list()).toHaveLength(1);
    removeListener.mockRestore();
  });

  it('clears successful execution timers and never aborts a finished handler later', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      registry.register(createTestTool({ handler: async (_input, _context, handlerSignal) => {
        signal = handlerSignal;
        return {};
      } }));
      await executor.execute('test_tool', {}, createContext('tenant-a'));

      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(2000);
      expect(signal?.aborted).toBe(false);
      expect(audit.list()).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores late handler completion after a timeout and audits only once', async () => {
    jest.useFakeTimers();
    try {
      let resolveHandler!: (value: unknown) => void;
      registry.register(createTestTool({ timeoutMs: 50, handler: async () =>
        new Promise((resolve) => { resolveHandler = resolve; }),
      }));
      const pending = executor.execute('test_tool', {}, createContext('tenant-a'));
      await jest.advanceTimersByTimeAsync(50);
      expect(await pending).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
      resolveHandler({ secret: 'late-result' });
      await Promise.resolve();

      expect(jest.getTimerCount()).toBe(0);
      expect(audit.list()).toHaveLength(1);
      expect(audit.list()[0].errorCode).toBe('TIMEOUT');
      expect(JSON.stringify(audit.list())).not.toContain('late-result');
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails closed for tools requiring an unimplemented confirmation flow', async () => {
    const handler = jest.fn(async () => ({}));
    registry.register(createTestTool({ requiresConfirmation: true, handler }));
    const result = await executor.execute('test_tool', {}, createContext('tenant-a'));

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('enforces the model runtime allowlist without restricting backend-controlled calls', async () => {
    const result = await executor.execute('knowledge_search', { query: 'earning plan' }, createContext('tenant-a'), undefined, {
      allowedToolNames: new Set(['get_products']),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'TOOL_NOT_OFFERED' } });
    expect((await executor.execute('knowledge_search', { query: 'earning plan' }, createContext('tenant-a'))).ok).toBe(true);
  });

  it.each([undefined, null, 42, '../private/secret-password', 'x'.repeat(65)])('rejects invalid tool names safely: %p', async (name) => {
    const result = await executor.execute(name, {}, createContext('tenant-a'));
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_NAME' } });
    expect(audit.list()[0].toolName).toBe('invalid_tool');
    expect(JSON.stringify([result, audit.list()])).not.toContain('secret-password');
  });
});
