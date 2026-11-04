import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { VoiceSessionManager } from './voice-session.manager';
import { VoiceTicketService } from './voice-ticket.service';
export declare class VoiceGateway implements OnModuleInit, OnModuleDestroy {
    private readonly adapterHost;
    private readonly tickets;
    private readonly sessions;
    private readonly logger;
    private readonly sockets;
    private pendingSockets;
    private server?;
    private wss?;
    private heartbeat?;
    constructor(adapterHost: HttpAdapterHost, tickets: VoiceTicketService, sessions: VoiceSessionManager);
    onModuleInit(): void;
    onModuleDestroy(): Promise<void>;
    private readonly onUpgrade;
    private upgrade;
    private attachClient;
    private releasePendingSocket;
    private pingClients;
    private hasProtocol;
    private isAllowedOrigin;
    private rejectUpgrade;
}
