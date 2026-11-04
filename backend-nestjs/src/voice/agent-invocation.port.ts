import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import type { AgentResponse } from '../agent/agent.service';

export interface AgentInvocationPort {
  invoke(question: string, context: AgentExecutionContext, signal: AbortSignal): Promise<AgentResponse>;
}

export const AGENT_INVOCATION = Symbol('AGENT_INVOCATION');
