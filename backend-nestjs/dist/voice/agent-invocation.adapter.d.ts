import { AgentService, type AgentResponse } from '../agent/agent.service';
import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import type { AgentInvocationPort } from './agent-invocation.port';
export declare class AgentInvocationAdapter implements AgentInvocationPort {
    private readonly agent;
    constructor(agent: AgentService);
    invoke(question: string, context: AgentExecutionContext, signal: AbortSignal): Promise<AgentResponse>;
}
