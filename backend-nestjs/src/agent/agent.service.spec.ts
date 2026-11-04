import { Logger, UnauthorizedException } from '@nestjs/common';
import { AgentService, type AgentResponse } from './agent.service';
import {
  AgentRuntimeConfigService,
  readAgentRuntimeConfig,
} from './config/agent-runtime-config.service';
import type { AgentExecutionContext } from './context/agent-execution-context.interface';
import { KnowledgeService } from './knowledge.service';
import type { ToolDefinition } from './tools/interfaces/tool-definition.interface';
import { ToolAuditService } from './tools/tool-audit.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { ToolPermissionService } from './tools/tool-permission.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolValidationService } from './tools/tool-validation.service';
import type { ConversationsService } from '../conversations/conversations.service';

function contextFor(
  tenantId = 'tenant-a',
  permissions = ['knowledge:read', 'products:read', 'inventory:read'],
): AgentExecutionContext {
  return { tenantId, permissions, requestId: `req-${tenantId}` };
}

function toolCall(name: unknown, args: unknown) {
  return { function: { name, arguments: args } };
}

function testTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'runtime_test_tool',
    description: 'Runtime test fixture, not an application tool.',
    category: 'custom',
    requiredPermissions: [],
    enabled: true,
    requiresConfirmation: false,
    timeoutMs: 1000,
    tenantMode: 'ALL_TENANTS',
    inputSchema: {
      type: 'object', required: [], properties: {}, additionalProperties: false,
    },
    handler: async () => ({ demonstrationData: true }),
    ...overrides,
  };
}

function expectCompatibleResponse(response: AgentResponse) {
  expect(Object.keys(response).sort()).toEqual([
    'answer', 'model', 'sources', 'success', 'toolCalls',
  ]);
  expect(typeof response.success).toBe('boolean');
  expect(typeof response.answer).toBe('string');
  expect(response.answer.length).toBeGreaterThan(0);
  expect(typeof response.model).toBe('string');
  expect(Array.isArray(response.toolCalls)).toBe(true);
  expect(Array.isArray(response.sources)).toBe(true);
}

type SentRequest = {
  model: string;
  stream: boolean;
  messages: Array<{ role: string; content: string; tool_name?: string; tool_calls?: unknown[] }>;
  tools?: Array<{ function: { name: string; parameters: unknown } }>;
};

describe('AgentService — hardened Ollama runtime (Ollama always mocked)', () => {
  let service: AgentService;
  let registry: ToolRegistryService;
  let audit: ToolAuditService;
  let executor: ToolExecutorService;
  let executeSpy: jest.SpiedFunction<ToolExecutorService['execute']>;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let warnSpy: jest.SpiedFunction<Logger['warn']>;

  beforeEach(async () => {
    registry = new ToolRegistryService(new KnowledgeService());
    await registry.onModuleInit();
    audit = new ToolAuditService();
    const permissions = new ToolPermissionService();
    executor = new ToolExecutorService(registry, permissions, new ToolValidationService(), audit);
    const config = { values: readAgentRuntimeConfig({}) } as AgentRuntimeConfigService;
    service = new AgentService(registry, executor, config, permissions);
    executeSpy = jest.spyOn(executor, 'execute');
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Unexpected unqueued Ollama request in a unit test.'),
    );
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function queueResponse(data: unknown) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  function queueAssistant(content: unknown, calls?: unknown) {
    queueResponse({
      model: 'qwen2.5:3b',
      message: {
        role: 'assistant', content,
        ...(calls !== undefined ? { tool_calls: calls } : {}),
      },
    });
  }

  function sentRequest(index: number): SentRequest {
    return JSON.parse(String(fetchMock.mock.calls[index][1]?.body)) as SentRequest;
  }

  function toolResults(index = 1): Array<Record<string, unknown>> {
    return sentRequest(index).messages
      .filter((message) => message.role === 'tool')
      .map((message) => JSON.parse(message.content) as Record<string, unknown>);
  }

  it('answers a normal conversation without executing a tool', async () => {
    queueAssistant('  Hello! How can I help?  ');
    const result = await service.ask('hello', contextFor());

    expect(result).toEqual({
      success: true, answer: 'Hello! How can I help?', model: 'qwen2.5:3b',
      toolCalls: [], sources: [],
    });
    expectCompatibleResponse(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(sentRequest(0).stream).toBe(false);
  });

  it('preserves backend knowledge search, its verified context and sources', async () => {
    queueAssistant('The earning plan is demonstration data only.');
    const result = await service.ask('Explain the earning plan', contextFor());

    expect(result.success).toBe(true);
    expect(result.toolCalls[0]).toMatchObject({ name: 'knowledge_search' });
    expect(result.toolCalls[0].resultCount).toBeGreaterThan(0);
    expect(result.sources).toContainEqual({
      id: 'plan-001', title: 'Example earning plan', source: 'demo://earning-plan',
    });
    expect(sentRequest(0).messages[0].content).toContain('VERIFIED APPLICATION KNOWLEDGE');
    expect(sentRequest(0).tools?.map((tool) => tool.function.name)).not.toContain('knowledge_search');
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expectCompatibleResponse(result);
  });

  it('preserves the no-knowledge answer without inventing information or calling Ollama', async () => {
    const result = await service.ask('Explain commission policy', contextFor());

    expect(result.success).toBe(true);
    expect(result.answer).toContain('could not find this information');
    expect(result.toolCalls).toEqual([{ name: 'knowledge_search', resultCount: 0 }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expectCompatibleResponse(result);
  });

  it('handles malformed knowledge results without a raw exception', async () => {
    executeSpy.mockResolvedValueOnce({ ok: true, data: [null] });
    const result = await service.ask('Explain the earning plan', contextFor());

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expectCompatibleResponse(result);
  });

  it('executes a product tool with missing assistant content through the real executor', async () => {
    queueResponse({ message: { tool_calls: [toolCall('get_product_details', { productId: 'prod-a-001' })] } });
    queueAssistant('ZenRun Running Shoes are demonstration products.');
    const result = await service.ask('Tell me about prod-a-001', contextFor());

    expect(result.success).toBe(true);
    expect(result.toolCalls).toEqual([{ name: 'get_product_details', resultCount: 1 }]);
    expect(toolResults()[0]).toMatchObject({
      demonstrationData: true, tenantId: 'tenant-a', found: true,
      product: { id: 'prod-a-001', name: 'ZenRun Running Shoes' },
    });
    expect(executeSpy.mock.calls[0][2].tenantId).toBe('tenant-a');
    expect(executeSpy.mock.calls[0][4]?.allowedToolNames?.has('get_product_details')).toBe(true);
    expectCompatibleResponse(result);
  });

  it('processes multiple tool calls in one round and correlates each tool response', async () => {
    queueAssistant('', [
      toolCall('get_products', { limit: 2 }),
      toolCall('get_product_details', { productId: 'prod-a-001' }),
      toolCall('check_inventory', { productId: 'prod-a-001' }),
    ]);
    queueAssistant('These are demo items; the shoes have 42 demo units.');
    const result = await service.ask('Show items and check prod-a-001', contextFor());

    expect(result.success).toBe(true);
    expect(result.toolCalls.map((call) => call.name)).toEqual([
      'get_products', 'get_product_details', 'check_inventory',
    ]);
    expect(executeSpy).toHaveBeenCalledTimes(3);
    expect(sentRequest(1).messages.filter((message) => message.role === 'tool')
      .map((message) => message.tool_name)).toEqual([
      'get_products', 'get_product_details', 'check_inventory',
    ]);
    expect(toolResults()[2]).toMatchObject({ quantity: 42, demonstrationData: true });
  });

  it('reserves the fourth round for a final answer using all completed results', async () => {
    queueAssistant('', [toolCall('get_products', {})]);
    queueAssistant('', [toolCall('get_product_details', { productId: 'prod-a-001' })]);
    queueAssistant('', [toolCall('check_inventory', { productId: 'prod-a-001' })]);
    queueAssistant('Final answer based on all three demo lookups.');
    const result = await service.ask('Show items and stock', contextFor());

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(executeSpy).toHaveBeenCalledTimes(3);
    expect(sentRequest(3).tools).toBeUndefined();
    expect(toolResults(3)).toHaveLength(3);
    expect(sentRequest(3).messages.at(-1)?.content).toContain('No more tools');
  });

  it('stops a model that continues requesting tools beyond the maximum round limit', async () => {
    for (let round = 0; round < 4; round++) {
      queueAssistant('', [toolCall('get_products', {})]);
    }
    const result = await service.ask('Show items', contextFor());

    expect(result.success).toBe(false);
    expect(result.answer).toContain('execution-round limit');
    expect(result.toolCalls).toHaveLength(3);
    expect(executeSpy).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sentRequest(3).tools).toBeUndefined();
    expectCompatibleResponse(result);
  });

  it('executes at most five calls from an oversized batch, then asks for a final answer', async () => {
    queueAssistant('', [
      ...Array.from({ length: 5 }, () => toolCall('get_products', {})),
      toolCall('check_inventory', { productId: 'prod-a-001' }),
    ]);
    queueAssistant('Final summary of the completed lookups.');
    const result = await service.ask('Show items', contextFor());

    expect(result.success).toBe(true);
    expect(executeSpy).toHaveBeenCalledTimes(5);
    expect(result.toolCalls).toHaveLength(5);
    expect(executeSpy.mock.calls.every((call) => call[0] === 'get_products')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentRequest(1).tools).toBeUndefined();
    expect(toolResults()).toHaveLength(5);
  });

  it('does not execute calls requested during tool-cap finalization', async () => {
    queueAssistant('', Array.from({ length: 5 }, () => toolCall('get_products', {})));
    queueAssistant('Unverified claim must not become an answer.', [toolCall('get_products', {})]);
    const result = await service.ask('Show items', contextFor());

    expect(result.success).toBe(false);
    expect(result.answer).toContain('tool-call limit');
    expect(result.answer).not.toContain('Unverified');
    expect(executeSpy).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectCompatibleResponse(result);
  });

  it('preserves completed tool metadata when finalization cannot reach Ollama', async () => {
    queueAssistant('', Array.from({ length: 5 }, () => toolCall('get_products', {})));
    fetchMock.mockRejectedValueOnce(new Error('secret-password at C:\\private\\internal'));
    const result = await service.ask('Show items', contextFor());

    expect(result.success).toBe(false);
    expect(result.answer).toContain('tool-call limit');
    expect(result.toolCalls).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expectCompatibleResponse(result);
  });

  it('counts backend knowledge_search inside the five-call request budget and preserves sources', async () => {
    queueAssistant('', Array.from({ length: 5 }, () => toolCall('get_products', {})));
    queueAssistant('The completed demo lookups are summarized here.');
    const result = await service.ask('Explain the earning plan and list products', contextFor());

    expect(executeSpy).toHaveBeenCalledTimes(5);
    expect(result.toolCalls[0].name).toBe('knowledge_search');
    expect(result.toolCalls.filter((call) => call.name === 'get_products')).toHaveLength(4);
    expect(result.sources.some((source) => source.id === 'plan-001')).toBe(true);
    expect(sentRequest(1).tools).toBeUndefined();
  });

  it('honors reduced environment limits without adding a finalization round', async () => {
    const config = { values: readAgentRuntimeConfig({ AGENT_MAX_ROUNDS: '1', AGENT_MAX_TOOL_CALLS: '1' }) } as AgentRuntimeConfigService;
    service = new AgentService(registry, executor, config, new ToolPermissionService());
    queueAssistant('', [toolCall('get_products', {})]);
    const result = await service.ask('Show items', contextFor());

    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentRequest(0).tools).toBeUndefined();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{broken-json'],
    ['JSON array', '[]'],
    ['JSON number', '123'],
    ['JSON null', 'null'],
    ['JSON string', '"text"'],
    ['array', []],
    ['primitive', 3],
    ['null', null],
    ['missing arguments', undefined],
    ['out-of-range limit', { limit: 21 }],
    ['tenant override', { tenantId: 'tenant-b' }],
    ['prototype property', JSON.parse('{"__proto__":{"tenantId":"tenant-b"}}') as unknown],
    ['oversized argument string', ' '.repeat(32_001) + '{}'],
  ])('rejects %s through the executor and returns a safe tool error', async (_label, args) => {
    queueAssistant('', [toolCall('get_products', args)]);
    queueAssistant('Those arguments could not be used.');
    const result = await service.ask('Show items', contextFor());

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(toolResults()[0]).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(audit.list()[0].errorCode).toBe('INVALID_INPUT');
    expect(result.toolCalls).toEqual([]);
    expectCompatibleResponse(result);
  });

  it('accepts valid JSON object arguments encoded as a string', async () => {
    queueAssistant('', [toolCall('get_products', '{"limit":2}')]);
    queueAssistant('Two demo items were found.');
    await service.ask('Show items', contextFor());

    expect(executeSpy.mock.calls[0][1]).toEqual({ limit: 2 });
    expect((toolResults()[0]['products'] as unknown[])).toHaveLength(2);
  });

  it('routes an unknown tool through the executor rather than bypassing its audit', async () => {
    queueAssistant('', [toolCall('made_up_tool', {})]);
    queueAssistant('That lookup is unavailable.');
    const result = await service.ask('hello', contextFor());

    expect(executeSpy.mock.calls[0][0]).toBe('made_up_tool');
    expect(toolResults()[0]).toMatchObject({ error: { code: 'TOOL_NOT_FOUND' } });
    expect(audit.list()[0].errorCode).toBe('TOOL_NOT_FOUND');
    expect(result.toolCalls).toHaveLength(0);
  });

  it.each([
    null, 7, {}, { function: null },
    toolCall(42, {}), toolCall('', {}), toolCall('../private/secret-password', {}),
  ])('handles a malformed tool-call entry: %p', async (call) => {
    queueAssistant('', [call]);
    queueAssistant('That lookup is invalid.');
    await service.ask('hello', contextFor());

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(toolResults()[0]).toMatchObject({ error: { code: 'INVALID_TOOL_NAME' } });
    expect(audit.list()[0].toolName).toBe('invalid_tool');
    expect(JSON.stringify(audit.list())).not.toContain('secret-password');
  });

  it('omits disabled tools from Ollama and safely rejects a hallucinated disabled tool', async () => {
    registry.getTool('get_products')!.enabled = false;
    queueAssistant('', [toolCall('get_products', {})]);
    queueAssistant('This lookup is disabled.');
    await service.ask('Show items', contextFor());

    expect(sentRequest(0).tools?.map((tool) => tool.function.name)).not.toContain('get_products');
    expect(toolResults()[0]).toMatchObject({ error: { code: 'TOOL_DISABLED' } });
    expect(audit.list()[0].outcome).toBe('rejected');
  });

  it('rechecks enabled status even if a tool was enabled when sent to Ollama', async () => {
    fetchMock.mockImplementationOnce(async () => {
      registry.getTool('get_products')!.enabled = false;
      return new Response(JSON.stringify({ message: { tool_calls: [toolCall('get_products', {})] } }));
    });
    queueAssistant('That lookup is no longer available.');
    await service.ask('Show items', contextFor());

    expect(sentRequest(0).tools?.map((tool) => tool.function.name)).toContain('get_products');
    expect(toolResults()[0]).toMatchObject({ error: { code: 'TOOL_DISABLED' } });
  });

  it('omits unpermitted tools and enforces permission errors in the executor', async () => {
    queueAssistant('', [toolCall('check_inventory', { productId: 'prod-a-001' })]);
    queueAssistant('Inventory access is not permitted.');
    await service.ask('Check stock', contextFor('tenant-a', ['products:read']));

    expect(sentRequest(0).tools?.map((tool) => tool.function.name)).not.toContain('check_inventory');
    expect(toolResults()[0]).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('prevents the model from invoking backend-only knowledge_search', async () => {
    queueAssistant('', [toolCall('knowledge_search', { query: 'earning plan' })]);
    queueAssistant('That lookup is not available in this conversation.');
    await service.ask('hello', contextFor());

    expect(toolResults()[0]).toMatchObject({ error: { code: 'TOOL_NOT_OFFERED' } });
    expect(audit.list()[0].outcome).toBe('rejected');
  });

  it('never offers or executes confirmation-required tools without a confirmation workflow', async () => {
    const handler = jest.fn(async () => ({}));
    registry.register(testTool({ requiresConfirmation: true, handler }));
    queueAssistant('', [toolCall('runtime_test_tool', {})]);
    queueAssistant('Explicit confirmation would be required.');
    await service.ask('hello', contextFor());

    expect(sentRequest(0).tools?.map((tool) => tool.function.name)).not.toContain('runtime_test_tool');
    expect(toolResults()[0]).toMatchObject({ error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('safely feeds tool timeouts back to Ollama and allows a final response', async () => {
    let handlerSignal: AbortSignal | undefined;
    registry.register(testTool({
      timeoutMs: 20,
      handler: async (_input, _context, signal) => {
        handlerSignal = signal;
        return new Promise(() => undefined);
      },
    }));
    queueAssistant('', [toolCall('runtime_test_tool', {})]);
    queueAssistant('The demo lookup timed out.');
    const result = await service.ask('hello', contextFor());

    expect(result.success).toBe(true);
    expect(handlerSignal?.aborted).toBe(true);
    expect(toolResults()[0]).toMatchObject({ error: { code: 'TIMEOUT' } });
    expect(audit.list()[0].outcome).toBe('timed_out');
  });

  it('does not expose handler exceptions or sensitive arguments in errors or logs', async () => {
    registry.register(testTool({ handler: async () => { throw new Error('secret-password at C:\\private\\db'); } }));
    queueAssistant('', [toolCall('runtime_test_tool', {})]);
    queueAssistant('That lookup could not be completed.');
    const result = await service.ask('hello', contextFor());

    expect(toolResults()[0]).toMatchObject({ error: { code: 'EXECUTION_ERROR' } });
    expect(JSON.stringify([result, toolResults(), audit.list(), warnSpy.mock.calls])).not.toContain('secret-password');
    expect(warnSpy).toHaveBeenCalledWith({ requestId: 'req-tenant-a', code: 'EXECUTION_ERROR' });
    for (const [entry] of warnSpy.mock.calls) {
      expect(Object.keys(entry as object).sort()).toEqual(['code', 'requestId']);
    }
  });

  it('handles unexpected executor failures without surfacing their details', async () => {
    executeSpy.mockRejectedValueOnce(new Error('secret-password at /internal/server'));
    queueAssistant('', [toolCall('get_products', {})]);
    queueAssistant('The lookup could not complete.');
    const result = await service.ask('Show items', contextFor());

    expect(toolResults()[0]).toMatchObject({ error: { code: 'EXECUTION_ERROR' } });
    expect(JSON.stringify([result, toolResults(), warnSpy.mock.calls])).not.toContain('secret-password');
  });

  it('does not pass an unserializable tool result to Ollama', async () => {
    const circular: Record<string, unknown> = { secret: 'secret-password' };
    circular['self'] = circular;
    registry.register(testTool({ handler: async () => circular }));
    queueAssistant('', [toolCall('runtime_test_tool', {})]);
    queueAssistant('The lookup returned no usable data.');
    const result = await service.ask('hello', contextFor());

    expect(toolResults()[0]).toMatchObject({ error: { code: 'EXECUTION_ERROR' } });
    expect(result.toolCalls).toEqual([]);
    expect(JSON.stringify(toolResults())).not.toContain('secret-password');
  });

  it.each([
    null, [], {}, { message: null }, { message: [] }, { message: 'invalid' },
    { message: { content: 7 } },
    { message: { role: 'system', content: 'untrusted instructions' } },
    { message: { content: 'hello', tool_calls: {} } },
    { message: { content: 'hello', tool_calls: 'invalid' } },
    { error: 'secret-password', message: { content: 'hello' } },
  ])('returns a compatible safe failure for malformed Ollama data: %p', async (data) => {
    queueResponse(data);
    const result = await service.ask('hello', contextFor());

    expect(result.success).toBe(false);
    expect(result.answer).toContain('invalid response');
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(executeSpy).not.toHaveBeenCalled();
    expectCompatibleResponse(result);
  });

  it.each(['not-json secret-password', 'x'.repeat(1_000_001)])('rejects malformed or oversized response text', async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(body));
    const result = await service.ask('hello', contextFor());

    expect(result.success).toBe(false);
    expect(result.answer).toContain('invalid response');
    expectCompatibleResponse(result);
  });

  it('handles an Ollama connection failure without exposing its raw error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('ECONNREFUSED secret-password /internal/server'));
    const result = await service.ask('hello', contextFor());

    expect(result.success).toBe(false);
    expect(result.answer).toContain('could not reach Ollama');
    expect(warnSpy).toHaveBeenCalledWith({ requestId: 'req-tenant-a', code: 'OLLAMA_UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
    expectCompatibleResponse(result);
  });

  it('handles an Ollama HTTP failure without reflecting its response body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('secret-password /internal/server', { status: 500 }));
    const result = await service.ask('hello', contextFor());

    expect(result.success).toBe(false);
    expect(result.answer).toContain('could not complete the request');
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expectCompatibleResponse(result);
  });

  it('times out Ollama, aborts the request and cleans up the deadline timer', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = service.ask('hello', contextFor());
    await jest.advanceTimersByTimeAsync(120_000);
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.answer).toContain('too long');
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expectCompatibleResponse(result);
  });

  it('applies the same deadline while reading a stalled response body', async () => {
    jest.useFakeTimers();
    const text = jest.fn(() => new Promise<string>(() => undefined));
    fetchMock.mockResolvedValueOnce({ ok: true, text } as unknown as Response);
    const pending = service.ask('hello', contextFor());
    await jest.advanceTimersByTimeAsync(120_000);
    const result = await pending;

    expect(text).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.answer).toContain('too long');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the Ollama deadline after a successful response', async () => {
    jest.useFakeTimers();
    queueAssistant('hello');
    const result = await service.ask('hello', contextFor());

    expect(result.success).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });

  it.each([
    {}, { content: '' }, { content: ' \n ' }, { content: null },
    { content: '', tool_calls: [] }, { content: '', tool_calls: null },
  ])('returns a clear safe answer for an empty model response: %p', async (message) => {
    queueResponse({ message });
    const result = await service.ask('hello', contextFor());

    expect(result.success).toBe(false);
    expect(result.answer).toContain('could not generate an answer');
    expectCompatibleResponse(result);
  });

  it('isolates tenant-a and tenant-b catalogue results over separate agent requests', async () => {
    queueAssistant('', [toolCall('get_products', {})]);
    queueAssistant('Tenant A demonstration items.');
    const tenantA = await service.ask('List products', contextFor('tenant-a'));
    queueAssistant('', [toolCall('get_products', {})]);
    queueAssistant('Tenant B demonstration items.');
    const tenantB = await service.ask('List products', contextFor('tenant-b'));

    const aData = JSON.stringify(toolResults(1));
    const bData = JSON.stringify(toolResults(3));
    expect(aData).toContain('prod-a-001');
    expect(aData).not.toContain('prod-b-');
    expect(bData).toContain('prod-b-001');
    expect(bData).not.toContain('prod-a-');
    expect(executeSpy.mock.calls.map((call) => call[2].tenantId)).toEqual(['tenant-a', 'tenant-b']);
    expectCompatibleResponse(tenantA);
    expectCompatibleResponse(tenantB);
  });

  it('sends only the current tenant\'s enabled and permitted tool metadata to Ollama', async () => {
    registry.register(testTool({
      name: 'tenant_b_only', description: 'Private tenant-b tool description.',
      tenantMode: 'RESTRICTED', allowedTenants: ['tenant-b'],
    }));
    queueAssistant('', [toolCall('tenant_b_only', {})]);
    queueAssistant('That lookup is unavailable.');
    await service.ask('hello', contextFor('tenant-a'));

    expect(JSON.stringify(sentRequest(0))).not.toContain('Private tenant-b');
    expect(toolResults()[0]).toMatchObject({ error: { code: 'TENANT_NOT_ALLOWED' } });
    expect(JSON.stringify(toolResults())).not.toContain('tenant-b');

    queueAssistant('hello');
    await service.ask('hello', contextFor('tenant-b'));
    expect(sentRequest(2).tools?.map((tool) => tool.function.name)).toContain('tenant_b_only');
  });

  it.each([
    ['get_product_details', 'tenant-a', 'prod-b-001'],
    ['check_inventory', 'tenant-a', 'prod-b-001'],
    ['get_product_details', 'tenant-b', 'prod-a-001'],
    ['check_inventory', 'tenant-b', 'prod-a-001'],
  ])('does not disclose foreign product data: %s / %s / %s', async (name, tenantId, productId) => {
    queueAssistant('', [toolCall(name, { productId })]);
    queueAssistant('The item was not found in your demo catalogue.');
    await service.ask('Look up this item', contextFor(tenantId));

    expect(toolResults()[0]).toMatchObject({ found: false, tenantId, demonstrationData: true });
    expect(JSON.stringify(toolResults())).not.toContain(productId);
    expect(JSON.stringify(toolResults())).not.toContain('quantity');
    expect(JSON.stringify(toolResults())).not.toContain('price');
  });

  it('does not allow handlers to mutate the backend tenant context or permissions', async () => {
    registry.register(testTool({ handler: async (_input, context) => {
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.permissions)).toBe(true);
      return { tenantId: context.tenantId };
    } }));
    queueAssistant('', [toolCall('runtime_test_tool', {})]);
    queueAssistant('Done.');
    await service.ask('hello', contextFor());

    expect(toolResults()[0]).toEqual({ tenantId: 'tenant-a' });
  });

  it.each([
    undefined, { tenantId: 'tenant-a' },
    { tenantId: 'tenant-a', permissions: [], requestId: 'bad\ntrace' },
    { tenantId: '__unset__', permissions: [], requestId: 'req-test' },
  ])('rejects invalid backend context before Ollama or any tool is invoked: %p', async (context) => {
    await expect(service.ask('hello', context as AgentExecutionContext)).rejects.toThrow(UnauthorizedException);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('uses configured Ollama values without sending configuration secrets in messages', async () => {
    const config = { values: readAgentRuntimeConfig({
      OLLAMA_BASE_URL: 'http://127.0.0.1:11435', OLLAMA_MODEL: 'local-qwen:latest',
      API_SECRET: 'secret-password',
    }) } as AgentRuntimeConfigService;
    service = new AgentService(registry, executor, config, new ToolPermissionService());
    queueResponse({ model: 'secret-password /internal/path', message: { tool_calls: [toolCall('get_products', {})] } });
    queueAssistant('Demo items are available.');
    const result = await service.ask('Show items', contextFor());

    expect(fetchMock.mock.calls.every((call) => call[0] === 'http://127.0.0.1:11435/api/chat')).toBe(true);
    expect(sentRequest(0).model).toBe('local-qwen:latest');
    expect(sentRequest(1).model).toBe('local-qwen:latest');
    expect(result.model).toBe('local-qwen:latest');
    expect(JSON.stringify(sentRequest(0).messages)).not.toContain('11435');
    expect(JSON.stringify([sentRequest(1), result, audit.list(), warnSpy.mock.calls])).not.toContain('secret-password');
  });

  it('loads verified conversation history and preserves the agent response contract when persistence fails', async () => {
    const conversationId = '018f47b2-7c00-7000-8000-000000000003';
    const assistantId = '018f47b2-7c00-7000-8000-000000000004';
    const conversations = {
      prepareAgentTurn: jest.fn().mockResolvedValue({
        assistantId,
        history: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }],
      }),
      persistTurn: jest.fn().mockRejectedValue(new Error('private database details')),
    };
    service = new AgentService(
      registry,
      executor,
      { values: readAgentRuntimeConfig({}) } as AgentRuntimeConfigService,
      new ToolPermissionService(),
      conversations as unknown as ConversationsService,
    );
    queueAssistant('New answer');

    const result = await service.ask('Current question', {
      ...contextFor(),
      userId: '018f47b2-7c00-7000-8000-000000000002',
      conversationId,
      permissions: ['conversations:write'],
    });

    expect(conversations.prepareAgentTurn).toHaveBeenCalledWith(conversationId, expect.any(Object));
    expect(conversations.persistTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId, assistantId,
    }), 'Current question', expect.any(Object), []);
    expect(sentRequest(0).messages.slice(1).map((message) => message.content)).toEqual([
      'Earlier question',
      'Earlier answer',
      'Current question',
    ]);
    expectCompatibleResponse(result);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('private database details');
  });
});
