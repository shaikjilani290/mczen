"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readStreamedAnswer = readStreamedAnswer;
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
async function readStreamedAnswer(response, format, onText) {
    if (!response.body)
        throw new Error('Missing provider stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let answer = '';
    let sentence = '';
    let bytes = 0;
    let finished = false;
    const parse = (line) => {
        if (format === 'sse') {
            if (!line.startsWith('data:'))
                return;
            line = line.slice(5).trim();
            if (line === '[DONE]') {
                finished = true;
                return;
            }
        }
        if (!line.trim())
            return;
        const data = JSON.parse(line);
        if (!record(data))
            throw new Error('Invalid provider stream.');
        const value = data;
        if (value.error !== undefined)
            throw new Error('Provider stream failed.');
        let delta;
        if (format === 'sse') {
            if (!Array.isArray(value.choices))
                throw new Error('Invalid streamed choices.');
            if (!value.choices.length)
                return;
            const choice = value.choices[0];
            if (!record(choice) || !record(choice.delta) || (choice.delta.role !== undefined && choice.delta.role !== 'assistant') ||
                choice.delta.tool_calls !== undefined)
                throw new Error('Unexpected streamed action.');
            delta = choice.delta.content;
            if (choice.finish_reason === 'length')
                throw new Error('Truncated provider answer.');
            if (choice.finish_reason === 'stop')
                finished = true;
        }
        else {
            const message = value.message;
            if (!record(message) || message.role !== 'assistant' || message.tool_calls !== undefined)
                throw new Error('Unexpected streamed action.');
            delta = message.content;
            if (value.done === true)
                finished = true;
        }
        if (delta !== undefined && delta !== null && typeof delta !== 'string')
            throw new Error('Invalid streamed content.');
        if (typeof delta !== 'string')
            return;
        answer += delta;
        sentence += delta;
        if (answer.length > 32000)
            throw new Error('Provider answer too large.');
        let match;
        while ((match = sentence.match(/^([\s\S]*?[.!?。！？])\s+/u))) {
            onText(match[1].trim());
            sentence = sentence.slice(match[0].length);
        }
    };
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > 2_000_000)
                throw new Error('Provider stream too large.');
            pending += decoder.decode(value, { stream: true });
            let index;
            while ((index = pending.indexOf('\n')) >= 0) {
                parse(pending.slice(0, index).replace(/\r$/, ''));
                pending = pending.slice(index + 1);
            }
        }
        pending += decoder.decode();
        if (pending.trim())
            parse(pending);
        if (!finished || !answer.trim())
            throw new Error('Incomplete provider stream.');
        if (sentence.trim())
            onText(sentence.trim());
        return answer;
    }
    finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
//# sourceMappingURL=streamed-answer.js.map