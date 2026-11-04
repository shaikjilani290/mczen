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
    const result = await this.agent.ask(question, context);
    signal.throwIfAborted();
    return result;
  }
}
