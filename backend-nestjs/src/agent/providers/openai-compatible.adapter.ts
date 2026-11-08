
type CompatibleToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type InternalMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id?: string;
    function: {
      name: string;
      arguments: unknown;
    };
  }>;
  tool_name?: string;
  tool_call_id?: string;
};

type CompatibleAssistantMessage = {
  content: string;
  toolCalls: unknown[];
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

/**
 * Converts McZEN's internal message format into
 * OpenAI-compatible chat completion messages.
 *
 * Tool call IDs are generated and tracked so that
 * assistant tool calls and tool results remain paired.
 */
export function toCompatibleMessages(
  messages: InternalMessage[],
): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];

  const pendingToolCalls = new Map<string, string[]>();

  messages.forEach((message, messageIndex) => {
    if (message.role === 'tool') {
      let toolCallId = message.tool_call_id;
      if (toolCallId) {
        const expectedId = toolCallId;
        const queues = message.tool_name
          ? [pendingToolCalls.get(message.tool_name)]
          : [...pendingToolCalls.values()];
        const queue = queues.find((candidate) => candidate?.includes(expectedId));
        if (!queue) {
          throw new Error('Tool response has no matching tool call.');
        }
        queue.splice(queue.indexOf(expectedId), 1);
      } else if (message.tool_name) {
        toolCallId = pendingToolCalls.get(message.tool_name)?.shift();
      }

      if (!toolCallId) {
        throw new Error('Tool response has no matching tool call.');
      }

      output.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: message.content,
      });

      return;
    }

    if (message.role === 'assistant' && message.tool_calls?.length) {
      const calls: CompatibleToolCall[] =
        message.tool_calls.map((call, callIndex) => {
          const name = call.function.name;

          const id =
            call.id ??
            `mczen_call_${messageIndex}_${callIndex}`;

          const argumentsJson = JSON.stringify(
            call.function.arguments ?? {},
          );

          if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) ||
              typeof id !== 'string' || !id || id.length > 256 ||
              typeof argumentsJson !== 'string') {
            throw new Error('Invalid tool arguments.');
          }

          const queue = pendingToolCalls.get(name) ?? [];
          queue.push(id);
          pendingToolCalls.set(name, queue);

          return {
            id,
            type: 'function',
            function: {
              name,
              arguments: argumentsJson,
            },
          };
        });

      output.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: calls,
      });

      return;
    }

    output.push({
      role: message.role,
      content: message.content,
    });
  });

  return output;
}

/**
 * Parses an OpenAI-compatible chat completion response
 * into McZEN's internal assistant message format.
 */
export function parseCompatibleResponse(
  value: unknown,
): CompatibleAssistantMessage {
  if (!isRecord(value) || value['error'] !== undefined) {
    throw new Error('Invalid provider response.');
  }

  const choices = value['choices'];

  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Provider response has no choices.');
  }

  const choice = choices[0];

  if (!isRecord(choice)) {
    throw new Error('Invalid provider choice.');
  }

  const message = choice['message'];

  if (!isRecord(message)) {
    throw new Error('Provider response has no assistant message.');
  }

  if (message['role'] !== 'assistant') {
    throw new Error('Unexpected provider message role.');
  }

  const content = message['content'];
  const rawCalls = message['tool_calls'];

  if (
    (content !== null && typeof content !== 'string') ||
    content === undefined
  ) {
    throw new Error('Invalid assistant content.');
  }

  if (
    rawCalls !== undefined &&
    rawCalls !== null &&
    !Array.isArray(rawCalls)
  ) {
    throw new Error('Invalid tool calls.');
  }

  const toolCalls: unknown[] = [];
  const callIds = new Set<string>();

  for (const rawCall of rawCalls ?? []) {
    if (!isRecord(rawCall)) {
      throw new Error('Invalid tool call.');
    }

    if (rawCall['type'] !== 'function') {
      throw new Error('Invalid tool call type.');
    }

    const fn = rawCall['function'];

    if (!isRecord(fn)) {
      throw new Error('Invalid tool function.');
    }

    const name = fn['name'];
    const args = fn['arguments'];

    if (
      typeof name !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)
    ) {
      throw new Error('Invalid tool function name.');
    }

    if (typeof args !== 'string' || args.length > 32_000) {
      throw new Error('Invalid tool arguments.');
    }

    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(args) as unknown;
    } catch {
      throw new Error('Invalid tool arguments.');
    }
    if (!isRecord(parsedArguments)) {
      throw new Error('Invalid tool arguments.');
    }

    const rawId = rawCall['id'];
    if (rawId !== undefined &&
        (typeof rawId !== 'string' || !rawId || rawId.length > 256 || callIds.has(rawId))) {
      throw new Error('Invalid tool call ID.');
    }
    if (typeof rawId === 'string') callIds.add(rawId);

    toolCalls.push({
      id: rawId,
      type: 'function',
      function: {
        name,
        arguments: args,
      },
    });
  }

  return {
    content: typeof content === 'string' ? content : '',
    toolCalls,
  };
}
