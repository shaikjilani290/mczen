import type { AgentService } from '../agent/agent.service';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import { AgentInvocationAdapter } from './agent-invocation.adapter';

describe('AgentInvocationAdapter', () => {
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
    expect(ask).toHaveBeenCalledWith('Hi', context);
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
