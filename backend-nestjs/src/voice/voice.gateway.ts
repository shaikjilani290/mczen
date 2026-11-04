import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { readCorsOptions } from '../auth/cors.config';
import type { VoiceIdentity } from './voice-auth.service';
import { VoiceSessionManager } from './voice-session.manager';
import { VoiceTicketService } from './voice-ticket.service';

const PATH = '/api/voice/stream';
const PROTOCOL = 'mczen-voice.v1';
const MAX_MESSAGE_BYTES = 64 * 1024;
const START_TIMEOUT_MS = 5_000;

@Injectable()
export class VoiceGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceGateway.name);
  private readonly sockets = new WeakMap<WebSocket, { alive: boolean; counted: boolean }>();
  private pendingSockets = 0;
  private server?: Server;
  private wss?: WebSocketServer;
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly tickets: VoiceTicketService,
    private readonly sessions: VoiceSessionManager,
  ) {}

  onModuleInit(): void {
    this.server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
      handleProtocols: (protocols) => protocols.has(PROTOCOL) ? PROTOCOL : false,
    });
    this.server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.pingClients(), 25_000);
    this.heartbeat.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.onUpgrade);
    await this.sessions.closeAll();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()) ?? resolve());
  }

  private readonly onUpgrade = (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    void this.upgrade(request, socket, head).catch(() => this.logger.warn('Voice WebSocket upgrade failed.'));
  };

  private async upgrade(
    request: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): Promise<void> {
    let path: string;
    try {
      path = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      return this.rejectUpgrade(socket, 400, 'Bad Request');
    }
    if (path !== PATH) return;
    if (request.url?.includes('?')) return this.rejectUpgrade(socket, 400, 'Query strings are not accepted');
    if (!this.hasProtocol(request)) {
      socket.write(`HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Protocol: ${PROTOCOL}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    const dashboardOrigin = this.isAllowedOrigin(origin);
    // Third-party (widget) origins are not on the dashboard allowlist. They may open the socket, but the first
    // message must carry a widget ticket that was issued after the tenant's exact-origin allowlist check
    // and is bound to this same Origin; anything else is closed as unauthorized.
    if (!dashboardOrigin && !isWellFormedOrigin(origin)) return this.rejectUpgrade(socket, 403, 'Origin denied');
    if (this.pendingSockets >= 48) return this.rejectUpgrade(socket, 429, 'Voice service busy');

    this.wss?.handleUpgrade(request, socket, head, (client) => {
      this.wss?.emit('connection', client, request);
      this.attachClient(client, origin!, request.headers['user-agent'], !dashboardOrigin);
    });
  }

  private attachClient(socket: WebSocket, origin: string, userAgent?: string, widgetOnly = false): void {
    this.pendingSockets++;
    this.sockets.set(socket, { alive: true, counted: true });
    let started = false;
    let starting = false;
    const timer = setTimeout(() => {
      if (!started) socket.close(4410, 'SESSION_START_TIMEOUT');
    }, START_TIMEOUT_MS);
    socket.on('pong', () => {
      const state = this.sockets.get(socket);
      if (state) state.alive = true;
    });
    socket.on('message', async (data, isBinary) => {
      if (!started) {
        if (isBinary || starting) {
          clearTimeout(timer);
          socket.close(4410, 'PROTOCOL_VIOLATION');
          return;
        }
        starting = true;
        let event: unknown;
        try {
          const text = toBuffer(data).toString('utf8');
          if (Buffer.byteLength(text, 'utf8') > 8 * 1024) throw new Error('oversize');
          event = JSON.parse(text) as unknown;
        } catch {
          clearTimeout(timer);
          socket.close(4410, 'PROTOCOL_VIOLATION');
          return;
        }
        if (!isStartEvent(event)) {
          clearTimeout(timer);
          socket.close(4410, 'PROTOCOL_VIOLATION');
          return;
        }
        let identity: VoiceIdentity;
        try {
          identity = await this.tickets.consume(event.data.ticket, origin);
          if (widgetOnly && !identity.widget) throw new Error('not a widget ticket');
        } catch {
          clearTimeout(timer);
          socket.send(JSON.stringify({
            v: 1,
            type: 'voice.session.error',
            ts: new Date().toISOString(),
            data: { code: 'UNAUTHORIZED', message: 'Voice authentication failed.', recoverable: false },
          }));
          socket.close(4401, 'UNAUTHORIZED');
          return;
        }
        if (socket.readyState !== WebSocket.OPEN) return;
        started = true;
        clearTimeout(timer);
        const { ticket: _ticket, ...startData } = event.data;
        void this.sessions.begin(socket, identity, startData, userAgent)
          .catch(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(JSON.stringify({
              v: 1, type: 'voice.session.error', ts: new Date().toISOString(),
              data: { code: 'VOICE_SESSION_UNAVAILABLE', message: 'A voice session could not be started.', recoverable: false },
            }));
            socket.close(4503, 'VOICE_SESSION_UNAVAILABLE');
          });
        return;
      }
      if (isBinary) {
        this.sessions.handleBinary(socket, toBuffer(data));
      } else {
        void this.sessions.handleText(socket, toBuffer(data));
      }
    });
    socket.on('close', () => {
      this.releasePendingSocket(socket);
      clearTimeout(timer);
      this.sessions.onDisconnect(socket);
      this.sockets.delete(socket);
    });
    socket.on('error', () => {
      this.releasePendingSocket(socket);
      this.sessions.onDisconnect(socket);
      this.sockets.delete(socket);
    });
  }

  private releasePendingSocket(socket: WebSocket): void {
    const state = this.sockets.get(socket);
    if (!state?.counted) return;
    state.counted = false;
    this.pendingSockets = Math.max(0, this.pendingSockets - 1);
  }

  private pingClients(): void {
    for (const socket of this.wss?.clients ?? []) {
      const state = this.sockets.get(socket);
      if (!state) continue;
      if (!state.alive) {
        socket.close(4408, 'HEARTBEAT_TIMEOUT');
        continue;
      }
      state.alive = false;
      socket.ping();
    }
  }

  private hasProtocol(request: IncomingMessage): boolean {
    const header = request.headers['sec-websocket-protocol'];
    return typeof header === 'string' && header.split(',').map((value) => value.trim()).includes(PROTOCOL);
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    try {
      const cors = readCorsOptions();
      if (typeof cors.origin !== 'function') return false;
      let accepted = false;
      cors.origin(origin, (error) => { accepted = !error; });
      return accepted;
    } catch {
      return false;
    }
  }

  private rejectUpgrade(socket: import('node:stream').Duplex, status: number, message: string): void {
    const phrase = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 503 ? 'Service Unavailable' : message;
    socket.write(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }
}

function isStartEvent(value: unknown): value is {
  v: 1;
  type: 'voice.session.start';
  ts: string;
  data: Record<string, unknown>;
} {
  if (!isRecord(value) || value.v !== 1 || value.type !== 'voice.session.start' ||
      typeof value.ts !== 'string' || !Number.isFinite(Date.parse(value.ts)) ||
      !isRecord(value.data)) return false;
  if (Object.keys(value).some((key) => !['v', 'type', 'ts', 'data'].includes(key))) return false;
  return typeof value.data.ticket === 'string' && !Object.keys(value.data).some((key) => key === 'tenantId');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function isWellFormedOrigin(origin: string | undefined): boolean {
  if (!origin || origin.length > 255) return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && !parsed.username && !parsed.password && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
