import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import type { AgentResponse } from '../agent/agent.service';
export interface AgentInvocationPort {
    invoke(question: string, context: AgentExecutionContext, signal: AbortSignal): Promise<AgentResponse>;
    stream?(question: string, context: AgentExecutionContext, signal: AbortSignal): AsyncIterable<{
        text: string;
    } | {
        response: AgentResponse;
        agentMs?: number;
    }>;
}
export declare const AGENT_INVOCATION: unique symbol;
