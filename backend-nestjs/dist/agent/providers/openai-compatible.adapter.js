"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCompatibleMessages = toCompatibleMessages;
exports.parseCompatibleResponse = parseCompatibleResponse;
function isRecord(value) {
    return (value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value));
}
function toCompatibleMessages(messages) {
    const output = [];
    const pendingToolCalls = new Map();
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
            }
            else if (message.tool_name) {
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
            const calls = message.tool_calls.map((call, callIndex) => {
                const name = call.function.name;
                const id = call.id ??
                    `mczen_call_${messageIndex}_${callIndex}`;
                const argumentsJson = JSON.stringify(call.function.arguments ?? {});
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
function parseCompatibleResponse(value) {
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
    if ((content !== null && typeof content !== 'string') ||
        content === undefined) {
        throw new Error('Invalid assistant content.');
    }
    if (rawCalls !== undefined &&
        rawCalls !== null &&
        !Array.isArray(rawCalls)) {
        throw new Error('Invalid tool calls.');
    }
    const toolCalls = [];
    const callIds = new Set();
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
        if (typeof name !== 'string' ||
            !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
            throw new Error('Invalid tool function name.');
        }
        if (typeof args !== 'string' || args.length > 32_000) {
            throw new Error('Invalid tool arguments.');
        }
        let parsedArguments;
        try {
            parsedArguments = JSON.parse(args);
        }
        catch {
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
        if (typeof rawId === 'string')
            callIds.add(rawId);
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
//# sourceMappingURL=openai-compatible.adapter.js.map