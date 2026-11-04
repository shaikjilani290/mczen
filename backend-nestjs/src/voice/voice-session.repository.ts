import { InjectDataSource } from '@nestjs/typeorm';
import { Optional, ServiceUnavailableException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { uuidToBinary } from '../common/ids/uuid';
import type { VoiceSession } from './voice.types';

@Injectable()
export class VoiceSessionRepository {
  constructor(@Optional() @InjectDataSource() private readonly source?: DataSource) {}

  async create(session: VoiceSession, clientInfo: string | null): Promise<void> {
    const database = this.getDatabase();
    const { context } = session;
    await database.query(
      `INSERT INTO \`voice_sessions\` (\`id\`,\`tenant_id\`,\`assistant_id\`,\`conversation_id\`,\`user_id\`,
        \`language_code\`,\`state\`,\`stt_engine\`,\`tts_engine\`,\`settings_snapshot\`,\`client_info\`,
        \`started_at\`,\`last_active_at\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuidToBinary(session.id),
        uuidToBinary(context.agent.tenantId),
        uuidToBinary(context.assistantId),
        context.conversationId ? uuidToBinary(context.conversationId) : null,
        context.agent.userId ? uuidToBinary(context.agent.userId) : null,
        context.language === 'auto' ? 'en' : context.language,
        'listening',
        context.settings.sttEngineId,
        context.settings.ttsEngineId,
        JSON.stringify(safeSettings(context.settings)),
        clientInfo,
        new Date(session.startedAt),
        new Date(session.startedAt),
      ],
    );
    await this.event(session, 'session_start');
  }

  async event(session: VoiceSession, event: string, detail?: string): Promise<void> {
    await this.getDatabase().query(
      `INSERT INTO \`voice_session_events\` (\`session_id\`,\`tenant_id\`,\`event\`,\`elapsed_ms\`,\`detail\`)
       VALUES (?,?,?,?,?)`,
      [
        uuidToBinary(session.id),
        uuidToBinary(session.context.agent.tenantId),
        event,
        Math.min(Date.now() - session.startedAt, 0xffffffff),
        detail ? detail.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 255) : null,
      ],
    );
  }

  async updateConversation(session: VoiceSession, conversationId: string): Promise<void> {
    await this.getDatabase().query(
      `UPDATE \`voice_sessions\` SET \`conversation_id\`=?,\`last_active_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`ended_at\` IS NULL`,
      [
        uuidToBinary(conversationId),
        uuidToBinary(session.id),
        uuidToBinary(session.context.agent.tenantId),
      ],
    );
  }

  async updateState(session: VoiceSession): Promise<void> {
    await this.getDatabase().query(
      `UPDATE \`voice_sessions\` SET \`state\`=?,\`language_code\`=?,\`last_active_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`ended_at\` IS NULL`,
      [
        session.state,
        session.context.language === 'auto' ? 'en' : session.context.language,
        uuidToBinary(session.id),
        uuidToBinary(session.context.agent.tenantId),
      ],
    );
  }

  async close(session: VoiceSession, reason: string, errorCode: string | null): Promise<void> {
    const now = Date.now();
    const total = Math.min(now - session.startedAt, 0xffffffff);
    await this.getDatabase().query(
      `UPDATE \`voice_sessions\` SET \`state\`='closed',\`audio_bytes_received\`=?,
        \`turn_count\`=\`turn_count\`+?,\`interrupt_count\`=\`interrupt_count\`+?,
        \`listen_ms\`=?,\`speak_ms\`=?,\`total_ms\`=?,\`error_code\`=?,\`close_reason\`=?,
        \`last_active_at\`=UTC_TIMESTAMP(3),\`ended_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`ended_at\` IS NULL`,
      [
        session.audioBytes,
        session.turnsCompleted,
        session.interrupts,
        Math.min(session.listenMs, 0xffffffff),
        Math.min(session.speakMs, 0xffffffff),
        total,
        errorCode,
        reason.slice(0, 50),
        uuidToBinary(session.id),
        uuidToBinary(session.context.agent.tenantId),
      ],
    );
    await this.event(session, 'session_close', errorCode ?? reason);
  }

  private getDatabase(): DataSource {
    if (!this.source) throw new ServiceUnavailableException('Voice persistence is unavailable.');
    return this.source;
  }
}

function safeSettings(settings: VoiceSession['context']['settings']): Record<string, unknown> {
  return {
    sttEngineId: settings.sttEngineId,
    ttsEngineId: settings.ttsEngineId,
    sttLanguageHint: settings.sttLanguageHint,
    ttsVoice: settings.ttsVoice,
    vadSensitivity: settings.vadSensitivity,
    endpointSilenceMs: settings.endpointSilenceMs,
    minSpeechMs: settings.minSpeechMs,
    silenceNudgeMs: settings.silenceNudgeMs,
    bargeInEnabled: settings.bargeInEnabled,
    speechRate: settings.speechRate,
  };
}
