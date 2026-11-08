import { createServer, type Server } from 'node:http';
import type { HttpAdapterHost } from '@nestjs/core';
import { WebSocket, type WebSocket as WebSocketClient } from 'ws';
import type { VoiceIdentity } from './voice-auth.service';
import { VoiceGateway } from './voice.gateway';

const ORIGIN = 'https://mczen.example';

describe('VoiceGateway ticket handshake', () => {
  let server: Server;
  let gateway: VoiceGateway;
  let client: WebSocketClient | undefined;
  let previousOrigins: string | undefined;
  const identity: VoiceIdentity = {
    userId: 'user-id',
    sessionId: 'session-id',
    tenantId: 'tenant-id',
    permissions: ['conversations:write'],
  };
  const tickets = { consume: jest.fn() };
  const sessions = {
    begin: jest.fn(),
    handleBinary: jest.fn(),
    handleText: jest.fn(),
    onDisconnect: jest.fn(),
    closeAll: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    previousOrigins = process.env.MCZEN_CORS_ORIGINS;
    process.env.MCZEN_CORS_ORIGINS = ORIGIN;
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const adapterHost = {
      httpAdapter: { getHttpServer: () => server },
    } as unknown as HttpAdapterHost;
    tickets.consume.mockReset().mockResolvedValue(identity);
    sessions.begin.mockReset().mockResolvedValue(undefined);
    gateway = new VoiceGateway(adapterHost, tickets as never, sessions as never);
    gateway.onModuleInit();
  });

  afterEach(async () => {
    client?.close();
    if (client?.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => client?.once('open', () => resolve()));
      client?.close();
    }
    if (client && client.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => client?.once('close', () => resolve()));
    }
    await gateway.onModuleDestroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    client = undefined;
    if (previousOrigins === undefined) delete process.env.MCZEN_CORS_ORIGINS;
    else process.env.MCZEN_CORS_ORIGINS = previousOrigins;
  });

  it('consumes the one-use ticket from the initial start event and removes it before session creation', async () => {
    client = openClient(server);
    await once(client, 'open');
    client.send(JSON.stringify({
      v: 1,
      type: 'voice.session.start',
      ts: new Date().toISOString(),
      data: { ticket: 'mzt_single-use-ticket', assistantId: 'assistant-id', language: 'en' },
    }));
    await waitFor(() => sessions.begin.mock.calls.length === 1);
    expect(tickets.consume).toHaveBeenCalledWith('mzt_single-use-ticket', ORIGIN);
    expect(sessions.begin.mock.calls[0][1]).toBe(identity);
    expect(sessions.begin.mock.calls[0][2]).toEqual({
      assistantId: 'assistant-id',
      language: 'en',
    });
  });

  it('closes the socket with a safe authentication error when ticket validation fails', async () => {
    tickets.consume.mockRejectedValue(new Error('invalid ticket'));
    client = openClient(server);
    await once(client, 'open');
    const errorEvent = once(client, 'message');
    const closed = once(client, 'close');
    client.send(JSON.stringify({
      v: 1,
      type: 'voice.session.start',
      ts: new Date().toISOString(),
      data: { ticket: 'mzt_single-use-ticket', assistantId: 'assistant-id' },
    }));
    const [message] = await errorEvent;
    expect(JSON.parse(String(message)).data).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Voice authentication failed.',
      recoverable: false,
    });
    const [code] = await closed;
    expect(code).toBe(4401);
    expect(sessions.begin).not.toHaveBeenCalled();
  });

  it('lets a third-party origin open the socket but only a widget ticket may start a session', async () => {
    const thirdParty = 'https://shop.example.test';
    tickets.consume.mockResolvedValue(identity);
    client = openClient(server, thirdParty);
    await once(client, 'open');
    const closed = once(client, 'close');
    client.send(JSON.stringify({ v: 1, type: 'voice.session.start', ts: new Date().toISOString(), data: { ticket: 'mzt_x' } }));
    const [code] = await closed;
    expect(code).toBe(4401);
    expect(tickets.consume).toHaveBeenCalledWith('mzt_x', thirdParty);
    expect(sessions.begin).not.toHaveBeenCalled();
  });

  it.each(['https://shop.example.test', 'http://localhost:5173', 'http://127.0.0.1:5173'])('starts a bound widget session from %s', async (origin) => {
    const widgetIdentity: VoiceIdentity = {
      ...identity, userId: '',
      widget: { assistantId: 'a', conversationId: 'c', widgetSessionId: 'w' },
    };
    tickets.consume.mockResolvedValue(widgetIdentity);
    client = openClient(server, origin);
    await once(client, 'open');
    client.send(JSON.stringify({ v: 1, type: 'voice.session.start', ts: new Date().toISOString(), data: { ticket: 'mzt_x', language: 'en' } }));
    await waitFor(() => sessions.begin.mock.calls.length === 1);
    expect(sessions.begin.mock.calls[0][1]).toBe(widgetIdentity);
    expect(tickets.consume).toHaveBeenCalledWith('mzt_x', origin);
  });

  it('keeps the startup deadline active until session creation finishes and aborts a hung start', async () => {
    let startupSignal: AbortSignal | undefined;
    sessions.begin.mockImplementation((_socket, _identity, _data, _ua, signal: AbortSignal) => {
      startupSignal = signal;
      return new Promise(() => {});
    });
    client = openClient(server);
    await once(client, 'open');
    const message = once(client, 'message');
    const closed = once(client, 'close');
    client.send(JSON.stringify({
      v: 1, type: 'voice.session.start', ts: new Date().toISOString(), data: { ticket: 'mzt_x', assistantId: 'a' },
    }));
    await waitFor(() => sessions.begin.mock.calls.length === 1);
    expect(startupSignal?.aborted).toBe(false);
    const [error] = await message;
    expect(JSON.parse(String(error)).data).toMatchObject({
      code: 'SESSION_START_TIMEOUT', recoverable: false,
    });
    expect(startupSignal?.aborted).toBe(true);
    const [code] = await closed;
    expect(code).toBe(4410);
  }, 8_000);

  it('rejects malformed origins at upgrade', async () => {
    client = openClient(server, 'https://user:pw@shop.example.test');
    await expect(new Promise((resolve, reject) => {
      client!.once('open', () => reject(new Error('should not open')));
      client!.once('error', resolve);
    })).resolves.toBeDefined();
  });
});

function openClient(server: Server, origin = ORIGIN): WebSocketClient {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  return new WebSocket(`ws://127.0.0.1:${address.port}/api/voice/stream`, 'mczen-voice.v1', {
    headers: { Origin: origin },
  });
}

function once(target: WebSocketClient, eventName: string): Promise<unknown[]> {
  return new Promise((resolve) => target.once(eventName, (...values: unknown[]) => resolve(values)));
}

async function waitFor(check: () => boolean): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 1_000) throw new Error('Timed out waiting for gateway call.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
