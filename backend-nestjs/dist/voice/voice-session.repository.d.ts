import { DataSource } from 'typeorm';
import type { VoiceSession } from './voice.types';
export declare class VoiceSessionRepository {
    private readonly source?;
    constructor(source?: DataSource | undefined);
    create(session: VoiceSession, clientInfo: string | null): Promise<void>;
    event(session: VoiceSession, event: string, detail?: string): Promise<void>;
    updateConversation(session: VoiceSession, conversationId: string): Promise<void>;
    updateState(session: VoiceSession): Promise<void>;
    close(session: VoiceSession, reason: string, errorCode: string | null): Promise<void>;
    private getDatabase;
}
