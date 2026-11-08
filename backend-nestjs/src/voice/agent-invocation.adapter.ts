import { Injectable } from '@nestjs/common';
import { AgentService, type AgentResponse } from '../agent/agent.service';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import type { AgentInvocationPort } from './agent-invocation.port';

@Injectable()
export class AgentInvocationAdapter implements AgentInvocationPort {
  constructor(private readonly agent: AgentService) {}

  async invoke(
    question: string,
    context: AgentExecutionContext,
    signal: AbortSignal,
  ): Promise<AgentResponse> {
    signal.throwIfAborted();
    const result = await this.agent.ask(question, context, { signal });
    signal.throwIfAborted();
    return result;
  }

  async *stream(question: string, context: AgentExecutionContext, signal: AbortSignal):
    AsyncIterable<{ text: string } | { response: AgentResponse; agentMs?: number }> {
    signal.throwIfAborted();
    const controller = new AbortController();
    let notify = () => {};
    const abort = () => { controller.abort(); notify(); };
    signal.addEventListener('abort', abort, { once: true });
    const queue: Array<{ text: string } | { response: AgentResponse; agentMs?: number }> = [];
    const startedAt = performance.now();
    let done = false;
    let failure: unknown;
    const pending = this.agent.ask(question, context, {
      signal: controller.signal,
      onText: text => { queue.push({ text }); notify(); },
    }).then(response => { queue.push({ response, agentMs: performance.now() - startedAt }); }, error => { failure = error; })
      .finally(() => { done = true; notify(); });
    try {
      while (!done || queue.length) {
        signal.throwIfAborted();
        const event = queue.shift();
        if (event) yield event;
        else await new Promise<void>(resolve => { notify = resolve; });
      }
      if (failure) throw failure;
    } finally {
      controller.abort();
      signal.removeEventListener('abort', abort);
      void pending;
    }
  }
}
