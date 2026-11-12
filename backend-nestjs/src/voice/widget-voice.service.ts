import { ForbiddenException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { VoiceLibraryService } from './voice-library.service';
import { SPEECH_TO_TEXT, type SpeechToTextPort } from './stt/stt.port';
import { TEXT_TO_SPEECH, type TextToSpeechPort } from './tts/tts.port';
import { VOICE_ACTIVITY, type VoiceActivityPort } from './vad/vad.port';
import { VoiceAuthService } from './voice-auth.service';
import { VoiceTicketService } from './voice-ticket.service';
import type { VoiceLanguage } from './voice.types';

const HEALTH_CACHE_MS = 15_000;
const UNHEALTHY_CACHE_MS = 1_000;
/** Anonymous visitors can only use voice for the same public catalogue permissions as widget text. */
const WIDGET_VOICE_PERMISSIONS = Object.freeze(['knowledge:read', 'products:read', 'inventory:read']);

export interface WidgetVoiceAvailability {
  voices?: Array<{ id: string; label: string; language: VoiceLanguage }>;
  available: boolean;
  /** Languages the assistant can both recognise and speak (TTS provider verified). */
  speechLanguages: VoiceLanguage[];
  /** Languages for which only text replies are possible (e.g. Telugu without a TTS voice). */
  textOnlyLanguages: VoiceLanguage[];
  diagnostics: {
    unavailable: Array<'stt' | 'tts' | 'vad'>;
    reason?: 'engines_unavailable' | 'assistant_settings_unavailable' | 'no_speech_language';
  };
}

/**
 * Anonymous widget voice. Availability is derived from live sidecar health and the assistant's persisted
 * voice settings, never from configuration alone. Health probes are cached so anonymous traffic cannot
 * amplify load on the sidecars.
 */
@Injectable()
export class WidgetVoiceService {
  private readonly logger = new Logger(WidgetVoiceService.name);
  private health?: { at: number; unavailable: Array<'stt' | 'tts' | 'vad'> };
  private probing?: Promise<Array<'stt' | 'tts' | 'vad'>>;

  constructor(
    private readonly auth: VoiceAuthService,
    private readonly tickets: VoiceTicketService,
    @Inject(SPEECH_TO_TEXT) private readonly stt: SpeechToTextPort,
    @Inject(TEXT_TO_SPEECH) private readonly tts: TextToSpeechPort,
    @Inject(VOICE_ACTIVITY) private readonly vad: VoiceActivityPort,
    @Optional() private readonly library?: VoiceLibraryService,
  ) {}

  async availability(tenantId: string, assistantId: string): Promise<WidgetVoiceAvailability> {
    const unavailable = await this.unavailableEngines();
    if (unavailable.length) return {
      available: false, speechLanguages: [], textOnlyLanguages: [],
      diagnostics: { unavailable, reason: 'engines_unavailable' },
    };
    try {
      const { allowedLanguages, ttsLanguages } = await this.auth.resolveSettings(tenantId, assistantId, 'auto');
      const speechLanguages = ttsLanguages.filter((language) => this.tts.supports(language));
      if (speechLanguages.length === 0) return {
        available: false, speechLanguages: [], textOnlyLanguages: allowedLanguages,
        diagnostics: { unavailable: [], reason: 'no_speech_language' },
      };
      return {
        available: true,
        speechLanguages,
        voices: [
          ...speechLanguages.flatMap((language) => this.tts.voices(language)),
          ...(this.library ? await this.library.activeForTenant(tenantId) : []),
        ].filter((voice) => speechLanguages.includes(voice.language)),
        textOnlyLanguages: allowedLanguages.filter((language) => !speechLanguages.includes(language)),
        diagnostics: { unavailable: [] },
      };
    } catch (error) {
      this.logger.warn({
        event: 'widget_voice_settings_unavailable', tenantId, assistantId,
        reason: error instanceof ForbiddenException ? error.message : 'Settings lookup failed.',
      });
      return {
        available: false, speechLanguages: [], textOnlyLanguages: [],
        diagnostics: { unavailable: [], reason: 'assistant_settings_unavailable' },
      };
    }
  }

  /** Caller must already have validated the widget session, origin allowlist and tenant/assistant binding. */
  async issueTicket(input: {
    tenantId: string; assistantId: string; conversationId: string; widgetSessionId: string; origin: string;
    merchant?: { integrationId: string; sessionId: string; origin: string };
  }): Promise<{ ticket: string; expiresInMs: number; availability: WidgetVoiceAvailability }> {
    this.logger.log({ event: 'widget_voice_capability_check', stage: 'checking_health_and_settings' });
    const availability = await this.availability(input.tenantId, input.assistantId);
    this.logger.log({ event: 'widget_voice_capability_check', stage: 'checked', available: availability.available,
      unavailable: availability.diagnostics.unavailable });
    if (!availability.available) throw new ServiceUnavailableException('Voice is currently unavailable.');
    if (!input.widgetSessionId) throw new ForbiddenException('Voice access is unavailable.');
    const issued = await this.tickets.issueIdentity({
      userId: '',
      sessionId: input.widgetSessionId,
      tenantId: input.tenantId,
      permissions: WIDGET_VOICE_PERMISSIONS,
      widget: {
        assistantId: input.assistantId,
        conversationId: input.conversationId,
        widgetSessionId: input.widgetSessionId,
        ...(input.merchant ? { merchant: input.merchant } : {}),
      },
    }, input.origin);
    return { ...issued, availability };
  }

  private async unavailableEngines(): Promise<Array<'stt' | 'tts' | 'vad'>> {
    const now = Date.now();
    const cacheMs = this.health?.unavailable.length ? UNHEALTHY_CACHE_MS : HEALTH_CACHE_MS;
    if (this.health && now - this.health.at < cacheMs) return this.health.unavailable;
    const engines = ['stt', 'tts', 'vad'] as const;
    this.probing ??= Promise.all([this.stt, this.tts, this.vad].map(async (port) => {
      try { return await port.healthCheck(); } catch { return false; }
    })).then((results) => {
      const unavailable = engines.filter((_, index) => !results[index]);
      this.health = { at: Date.now(), unavailable };
      if (unavailable.length) this.logger.warn({ event: 'widget_voice_engines_unavailable', engines: unavailable });
      return unavailable;
    }).finally(() => { this.probing = undefined; });
    return this.probing;
  }
}
