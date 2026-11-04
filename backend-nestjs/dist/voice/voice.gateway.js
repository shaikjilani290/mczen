"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var VoiceGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceGateway = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const ws_1 = require("ws");
const cors_config_1 = require("../auth/cors.config");
const voice_session_manager_1 = require("./voice-session.manager");
const voice_ticket_service_1 = require("./voice-ticket.service");
const PATH = '/api/voice/stream';
const PROTOCOL = 'mczen-voice.v1';
const MAX_MESSAGE_BYTES = 64 * 1024;
const START_TIMEOUT_MS = 5_000;
let VoiceGateway = VoiceGateway_1 = class VoiceGateway {
    adapterHost;
    tickets;
    sessions;
    logger = new common_1.Logger(VoiceGateway_1.name);
    sockets = new WeakMap();
    pendingSockets = 0;
    server;
    wss;
    heartbeat;
    constructor(adapterHost, tickets, sessions) {
        this.adapterHost = adapterHost;
        this.tickets = tickets;
        this.sessions = sessions;
    }
    onModuleInit() {
        this.server = this.adapterHost.httpAdapter.getHttpServer();
        this.wss = new ws_1.WebSocketServer({
            noServer: true,
            maxPayload: MAX_MESSAGE_BYTES,
            perMessageDeflate: false,
            handleProtocols: (protocols) => protocols.has(PROTOCOL) ? PROTOCOL : false,
        });
        this.server.on('upgrade', this.onUpgrade);
        this.heartbeat = setInterval(() => this.pingClients(), 25_000);
        this.heartbeat.unref();
    }
    async onModuleDestroy() {
        if (this.heartbeat)
            clearInterval(this.heartbeat);
        this.server?.off('upgrade', this.onUpgrade);
        await this.sessions.closeAll();
        await new Promise((resolve) => this.wss?.close(() => resolve()) ?? resolve());
    }
    onUpgrade = (request, socket, head) => {
        void this.upgrade(request, socket, head).catch(() => this.logger.warn('Voice WebSocket upgrade failed.'));
    };
    async upgrade(request, socket, head) {
        let path;
        try {
            path = new URL(request.url ?? '/', 'http://localhost').pathname;
        }
        catch {
            return this.rejectUpgrade(socket, 400, 'Bad Request');
        }
        if (path !== PATH)
            return;
        if (request.url?.includes('?'))
            return this.rejectUpgrade(socket, 400, 'Query strings are not accepted');
        if (!this.hasProtocol(request)) {
            socket.write(`HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Protocol: ${PROTOCOL}\r\nConnection: close\r\n\r\n`);
            socket.destroy();
            return;
        }
        const origin = request.headers.origin;
        const dashboardOrigin = this.isAllowedOrigin(origin);
        if (!dashboardOrigin && !isWellFormedOrigin(origin))
            return this.rejectUpgrade(socket, 403, 'Origin denied');
        if (this.pendingSockets >= 48)
            return this.rejectUpgrade(socket, 429, 'Voice service busy');
        this.wss?.handleUpgrade(request, socket, head, (client) => {
            this.wss?.emit('connection', client, request);
            this.attachClient(client, origin, request.headers['user-agent'], !dashboardOrigin);
        });
    }
    attachClient(socket, origin, userAgent, widgetOnly = false) {
        this.pendingSockets++;
        this.sockets.set(socket, { alive: true, counted: true });
        let started = false;
        let starting = false;
        const timer = setTimeout(() => {
            if (!started)
                socket.close(4410, 'SESSION_START_TIMEOUT');
        }, START_TIMEOUT_MS);
        socket.on('pong', () => {
            const state = this.sockets.get(socket);
            if (state)
                state.alive = true;
        });
        socket.on('message', async (data, isBinary) => {
            if (!started) {
                if (isBinary || starting) {
                    clearTimeout(timer);
                    socket.close(4410, 'PROTOCOL_VIOLATION');
                    return;
                }
                starting = true;
                let event;
                try {
                    const text = toBuffer(data).toString('utf8');
                    if (Buffer.byteLength(text, 'utf8') > 8 * 1024)
                        throw new Error('oversize');
                    event = JSON.parse(text);
                }
                catch {
                    clearTimeout(timer);
                    socket.close(4410, 'PROTOCOL_VIOLATION');
                    return;
                }
                if (!isStartEvent(event)) {
                    clearTimeout(timer);
                    socket.close(4410, 'PROTOCOL_VIOLATION');
                    return;
                }
                let identity;
                try {
                    identity = await this.tickets.consume(event.data.ticket, origin);
                    if (widgetOnly && !identity.widget)
                        throw new Error('not a widget ticket');
                }
                catch {
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
                if (socket.readyState !== ws_1.WebSocket.OPEN)
                    return;
                started = true;
                clearTimeout(timer);
                const { ticket: _ticket, ...startData } = event.data;
                void this.sessions.begin(socket, identity, startData, userAgent)
                    .catch(() => {
                    if (socket.readyState !== ws_1.WebSocket.OPEN)
                        return;
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
            }
            else {
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
    releasePendingSocket(socket) {
        const state = this.sockets.get(socket);
        if (!state?.counted)
            return;
        state.counted = false;
        this.pendingSockets = Math.max(0, this.pendingSockets - 1);
    }
    pingClients() {
        for (const socket of this.wss?.clients ?? []) {
            const state = this.sockets.get(socket);
            if (!state)
                continue;
            if (!state.alive) {
                socket.close(4408, 'HEARTBEAT_TIMEOUT');
                continue;
            }
            state.alive = false;
            socket.ping();
        }
    }
    hasProtocol(request) {
        const header = request.headers['sec-websocket-protocol'];
        return typeof header === 'string' && header.split(',').map((value) => value.trim()).includes(PROTOCOL);
    }
    isAllowedOrigin(origin) {
        if (!origin)
            return false;
        try {
            const cors = (0, cors_config_1.readCorsOptions)();
            if (typeof cors.origin !== 'function')
                return false;
            let accepted = false;
            cors.origin(origin, (error) => { accepted = !error; });
            return accepted;
        }
        catch {
            return false;
        }
    }
    rejectUpgrade(socket, status, message) {
        const phrase = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 503 ? 'Service Unavailable' : message;
        socket.write(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        socket.destroy();
    }
};
exports.VoiceGateway = VoiceGateway;
exports.VoiceGateway = VoiceGateway = VoiceGateway_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.HttpAdapterHost,
        voice_ticket_service_1.VoiceTicketService,
        voice_session_manager_1.VoiceSessionManager])
], VoiceGateway);
function isStartEvent(value) {
    if (!isRecord(value) || value.v !== 1 || value.type !== 'voice.session.start' ||
        typeof value.ts !== 'string' || !Number.isFinite(Date.parse(value.ts)) ||
        !isRecord(value.data))
        return false;
    if (Object.keys(value).some((key) => !['v', 'type', 'ts', 'data'].includes(key)))
        return false;
    return typeof value.data.ticket === 'string' && !Object.keys(value.data).some((key) => key === 'tenantId');
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function toBuffer(data) {
    if (Buffer.isBuffer(data))
        return data;
    if (Array.isArray(data))
        return Buffer.concat(data);
    return Buffer.from(data);
}
function isWellFormedOrigin(origin) {
    if (!origin || origin.length > 255)
        return false;
    try {
        const parsed = new URL(origin);
        return parsed.origin === origin && !parsed.username && !parsed.password && ['http:', 'https:'].includes(parsed.protocol);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=voice.gateway.js.map