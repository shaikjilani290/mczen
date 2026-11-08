import type { AgentService, AgentTurnOptions } from '../agent/agent.service';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { AgentInvocationAdapter } from './agent-invocation.adapter';

describe('AgentInvocationAdapter', () => {
  it('delivers streamed text before the final response and forwards cancellation to inference', async () => {
    let finish!: () => void;
    const completed = new Promise<void>(resolve => { finish = resolve; });
    const response = { success: true, answer: 'Hello.', model: 'gpu', toolCalls: [], sources: [] };
    const ask = jest.fn(async (_question: string, _context: AgentExecutionContext, options: AgentTurnOptions) => {
      options.onText?.('Hello.');
      await completed;
      return response;
    });
    const adapter = new AgentInvocationAdapter({ ask } as unknown as AgentService);
    const context: AgentExecutionContext = { tenantId: 'tenant-a', permissions: [], requestId: 'turn-1' };
    const iterator = adapter.stream('Hello', context, new AbortController().signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ text: 'Hello.' });
    finish();
    expect((await iterator.next()).value).toEqual({ response, agentMs: expect.any(Number) });
    expect((await iterator.next()).done).toBe(true);
    expect(ask.mock.calls[0][2].signal?.aborted).toBe(true);
  });
  it('preserves the agent response contract and passes the verified execution context', async () => {
    const response = {
      success: true,
      answer: 'Hello.',
      model: 'ollama',
      toolCalls: [],
      sources: [],
    };
    const ask = jest.fn().mockResolvedValue(response);
    const adapter = new AgentInvocationAdapter({ ask } as unknown as AgentService);
    const context: AgentExecutionContext = {
      tenantId: 'tenant-a',
      userId: 'user-a',
      assistantId: 'assistant-a',
      conversationId: 'conversation-a',
      modality: 'voice',
      permissions: ['conversations:write'],
      requestId: 'request-1',
    };

    await expect(adapter.invoke('Hi', context, new AbortController().signal)).resolves.toBe(response);
    expect(ask).toHaveBeenCalledWith('Hi', context, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('does not start an agent request after its turn has been cancelled', async () => {
    const ask = jest.fn();
    const adapter = new AgentInvocationAdapter({ ask } as unknown as AgentService);
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.invoke('Hi', {
      tenantId: 'tenant-a',
      permissions: [],
      requestId: 'request-1',
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(ask).not.toHaveBeenCalled();
  });
});
