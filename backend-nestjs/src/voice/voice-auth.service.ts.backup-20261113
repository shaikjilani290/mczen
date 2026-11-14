import {
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { live } from '../auth/auth.service';
import { AuthStore } from '../auth/auth-store.service';
import { TokenService } from '../auth/token.service';
import { isUuidv7, uuidToBinary } from '../common/ids/uuid';
import type { VoiceLanguage, VoiceSettings } from './voice.types';

export interface VoiceWidgetBinding {
  assistantId: string;
  conversationId: string;
  widgetSessionId: string;
  merchant?: { integrationId: string; sessionId: string; origin: string };
}

export interface VoiceIdentity {
  /** Empty for anonymous widget visitors; they are identified by `widget.widgetSessionId`. */
  userId: string;
  sessionId: string;
  tenantId: string;
  permissions: readonly string[];
  widget?: VoiceWidgetBinding;
}

@Injectable()
export class VoiceAuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly authStore: AuthStore,
    @Optional() @InjectDataSource() private readonly database?: DataSource,
  ) {}

  async authenticate(bearer: string): Promise<VoiceIdentity> {
    const verified = this.tokens.verify(bearer);
    if (!verified.ok || !verified.claims.tenantId) throw new UnauthorizedException('Authentication required.');
    const { userId, sessionId, tenantId } = verified.claims;
    const [user, session, membership, tenant] = await Promise.all([
      this.authStore.findUserById(userId),
      this.authStore.findSession(sessionId),
      this.authStore.findMembership(userId, tenantId),
      this.authStore.findTenant(tenantId),
    ]);
    if (!session || !live(user, session) || session.activeTenantId !== tenantId ||
        membership?.status !== 'active') throw new UnauthorizedException('Authentication required.');
    if (tenant?.status !== 'active') throw new ForbiddenException('Tenant access is unavailable.');
    const permissions = await this.authStore.rolePermissions(membership.roleId);
    if (!permissions.includes('conversations:write')) throw new ForbiddenException('Permission denied.');
    await this.authStore.touchSession(userId, sessionId);
    return { userId, sessionId, tenantId, permissions: Object.freeze(permissions) };
  }

  async resolveSettings(
    tenantId: string,
    assistantId: string,
    requestedLanguage: 'auto' | VoiceLanguage,
  ): Promise<{
    settings: VoiceSettings;
    allowedLanguages: VoiceLanguage[];
    ttsLanguages: VoiceLanguage[];
    defaultLanguage: VoiceLanguage;
  }> {
    if (!isUuidv7(assistantId)) throw new ForbiddenException('Assistant access is unavailable.');
    const rows = await this.getDatabase().query(
      `SELECT a.\`id\`,avs.\`speech_enabled\`,avs.\`stt_engine\`,avs.\`stt_language_hint\`,avs.\`tts_engine\`,
        avs.\`tts_voice_fallback\`,avs.\`speech_rate\`,avs.\`vad_sensitivity\`,avs.\`endpoint_silence_ms\`,
        avs.\`min_speech_ms\`,avs.\`barge_in_enabled\`,avs.\`silence_nudge_after_s\`,avs.\`session_idle_timeout_s\`,
        als.\`language_code\`,als.\`is_default\`,als.\`voice_enabled\`,als.\`tts_voice\`,als.\`tts_rate\`
       FROM \`assistants\` a
       JOIN \`assistant_voice_settings\` avs ON avs.\`assistant_id\`=a.\`id\` AND avs.\`tenant_id\`=a.\`tenant_id\`
       LEFT JOIN \`assistant_language_settings\` als ON als.\`assistant_id\`=a.\`id\`
          AND als.\`tenant_id\`=a.\`tenant_id\` AND als.\`is_enabled\`=1
       WHERE a.\`id\`=? AND a.\`tenant_id\`=? AND a.\`status\`='active' AND a.\`deleted_at\` IS NULL`,
      [uuidToBinary(assistantId), uuidToBinary(tenantId)],
    ) as Array<Record<string, unknown>>;
    if (!rows.length || Number(rows[0].speech_enabled) !== 1) {
      throw new ForbiddenException('Assistant voice is unavailable.');
    }

    const languages = new Map<VoiceLanguage, { enabled: boolean; voice: string | null; rate: number | null; isDefault: boolean }>();
    for (const row of rows) {
      const code = row.language_code;
      if (code !== 'en' && code !== 'hi' && code !== 'te') continue;
      languages.set(code, {
        enabled: Number(row.voice_enabled) === 1,
        voice: typeof row.tts_voice === 'string' ? row.tts_voice : null,
        rate: row.tts_rate === null || row.tts_rate === undefined ? null : Number(row.tts_rate),
        isDefault: Number(row.is_default) === 1,
      });
    }
    const allowedLanguages = [...languages.keys()];
    const ttsLanguages = [...languages.entries()]
      .filter(([, value]) => value.enabled)
      .map(([code]) => code);
    const defaultLanguage = (
      [...languages.entries()].find(([, value]) => value.isDefault)?.[0] ??
      allowedLanguages[0] ??
      'en'
    ) as VoiceLanguage;
    if (requestedLanguage !== 'auto' && !allowedLanguages.includes(requestedLanguage)) {
      throw new ForbiddenException('Voice is not enabled for the selected language.');
    }
    const selected = requestedLanguage === 'auto' ? languages.get(defaultLanguage) : languages.get(requestedLanguage);
    const row = rows[0];
    const sttEngineId = String(row.stt_engine);
    const ttsEngineId = String(row.tts_engine);
    if (sttEngineId !== 'faster-whisper-small-int8' || ttsEngineId !== 'piper') {
      throw new ForbiddenException('The configured voice engine is unavailable.');
    }
    const speechRate = selected?.rate ?? Number(row.speech_rate);
    if (speechRate < 0.5 || speechRate > 2 || Number(row.vad_sensitivity) < 0 || Number(row.vad_sensitivity) > 1) {
      throw new ForbiddenException('Assistant voice settings are invalid.');
    }
    return {
      settings: {
        sttEngineId,
        ttsEngineId,
        sttLanguageHint: row.stt_language_hint as VoiceSettings['sttLanguageHint'],
        ttsVoice: selected?.voice ?? null,
        ttsVoiceFallback: typeof row.tts_voice_fallback === 'string' ? row.tts_voice_fallback : null,
        speechRate,
        vadSensitivity: Number(row.vad_sensitivity),
        endpointSilenceMs: clamp(Number(row.endpoint_silence_ms), 300, 2000, 1000),
        minSpeechMs: clamp(Number(row.min_speech_ms), 20, 500, 80),
        silenceNudgeMs: clamp(Number(row.silence_nudge_after_s), 5, 60, 10) * 1000,
        bargeInEnabled: Number(row.barge_in_enabled) === 1,
        idleTimeoutMs: clamp(Number(row.session_idle_timeout_s), 60, 3600, 300) * 1000,
      },
      allowedLanguages,
      ttsLanguages,
      defaultLanguage,
    };
  }

  async resolveLanguageVoice(
    tenantId: string,
    assistantId: string,
    language: VoiceLanguage,
  ): Promise<{ enabled: boolean; voice: string | null; rate: number | null }> {
    const rows = await this.getDatabase().query(
      `SELECT als.\`voice_enabled\`,als.\`tts_voice\`,als.\`tts_rate\`
       FROM \`assistant_language_settings\` als
       JOIN \`assistants\` a ON a.\`id\`=als.\`assistant_id\` AND a.\`tenant_id\`=als.\`tenant_id\`
       WHERE als.\`assistant_id\`=? AND als.\`tenant_id\`=? AND als.\`language_code\`=?
         AND als.\`is_enabled\`=1 AND a.\`status\`='active' AND a.\`deleted_at\` IS NULL`,
      [uuidToBinary(assistantId), uuidToBinary(tenantId), language],
    ) as Array<{ voice_enabled: number; tts_voice: string | null; tts_rate: number | string | null }>;
    const row = rows[0];
    return {
      enabled: row !== undefined && Number(row.voice_enabled) === 1,
      voice: row?.tts_voice ?? null,
      rate: row?.tts_rate === null || row?.tts_rate === undefined ? null : Number(row.tts_rate),
    };
  }

  private getDatabase(): DataSource {
    if (!this.database) throw new ServiceUnavailableException('Voice authorization is unavailable.');
    return this.database;
  }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
