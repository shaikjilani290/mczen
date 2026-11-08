import { readStreamedAnswer } from './streamed-answer';

describe('bounded final-answer streaming', () => {
  it('emits a completed sentence before the provider finishes, across split SSE frames', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const text: string[] = [];
    const result = readStreamedAnswer(new Response(stream), 'sse', value => text.push(value));
    const encode = (content: string) => new TextEncoder().encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    const first = encode('ZENAGE costs 9000. ');
    controller.enqueue(first.slice(0, 15));
    controller.enqueue(first.slice(15));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(text).toEqual(['ZENAGE costs 9000.']);
    controller.enqueue(encode('Check the packaging.'));
    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    controller.close();
    await expect(result).resolves.toBe('ZENAGE costs 9000. Check the packaging.');
    expect(text).toEqual(['ZENAGE costs 9000.', 'Check the packaging.']);
  });
  it('supports native Ollama NDJSON without changing provider message format', async () => {
    const text: string[] = [];
    const response = new Response([
      JSON.stringify({ message: { role: 'assistant', content: 'Hello. ' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: 'Welcome.' }, done: true }),
    ].join('\n'));
    await expect(readStreamedAnswer(response, 'ndjson', value => text.push(value))).resolves.toBe('Hello. Welcome.');
    expect(text).toEqual(['Hello.', 'Welcome.']);
  });
  it.each([
    'data: {"choices":[{"delta":{"tool_calls":[]}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Partial"},"finish_reason":"length"}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
    'data: invalid\n\n',
  ])('rejects tool actions, truncation and malformed/incomplete streams', async body => {
    await expect(readStreamedAnswer(new Response(body), 'sse', () => {})).rejects.toThrow();
  });
});
