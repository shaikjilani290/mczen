import { ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SPEECH_TO_TEXT, type SpeechToTextPort } from './stt/stt.port';
import { TEXT_TO_SPEECH, type TextToSpeechPort } from './tts/tts.port';
import { VOICE_ACTIVITY, type VoiceActivityPort } from './vad/vad.port';
import { VoiceAuthService } from './voice-auth.service';
import { VoiceTicketService } from './voice-ticket.service';
import type { VoiceLanguage } from './voice.types';

const HEALTH_CACHE_MS = 15_000;
/** Anonymous visitors can only use voice for the same public catalogue permissions as widget text. */
const WIDGET_VOICE_PERMISSIONS = Object.freeze(['knowledge:read', 'products:read', 'inventory:read']);

export interface WidgetVoiceAvailability {
  available: boolean;
  /** Languages the assistant can both recognise and speak (TTS provider verified). */
  speechLanguages: VoiceLanguage[];
  /** Languages for which only text replies are possible (e.g. Telugu without a TTS voice). */
  textOnlyLanguages: VoiceLanguage[];
}

const UNAVAILABLE: WidgetVoiceAvailability = { available: false, speechLanguages: [], textOnlyLanguages: [] };

/**
 * Anonymous widget voice. Availability is derived from live sidecar health and the assistant's persisted
 * voice settings, never from configuration alone. Health probes are cached so anonymous traffic cannot
 * amplify load on the sidecars.
 */
@Injectable()
export class WidgetVoiceService {
  private health?: { at: number; ok: boolean };
  private probing?: Promise<boolean>;

  constructor(
    private readonly auth: VoiceAuthService,
    private readonly tickets: VoiceTicketService,
    @Inject(SPEECH_TO_TEXT) private readonly stt: SpeechToTextPort,
    @Inject(TEXT_TO_SPEECH) private readonly tts: TextToSpeechPort,
    @Inject(VOICE_ACTIVITY) private readonly vad: VoiceActivityPort,
  ) {}

  async availability(tenantId: string, assistantId: string): Promise<WidgetVoiceAvailability> {
    if (!(await this.enginesHealthy())) return UNAVAILABLE;
    try {
      const { allowedLanguages, ttsLanguages } = await this.auth.resolveSettings(tenantId, assistantId, 'auto');
      const speechLanguages = ttsLanguages.filter((language) => this.tts.supports(language));
      if (speechLanguages.length === 0) return UNAVAILABLE;
      return {
        available: true,
        speechLanguages,
        textOnlyLanguages: allowedLanguages.filter((language) => !speechLanguages.includes(language)),
      };
    } catch {
      return UNAVAILABLE;
    }
  }

  /** Caller must already have validated the widget session, origin allowlist and tenant/assistant binding. */
  async issueTicket(input: {
    tenantId: string; assistantId: string; conversationId: string; widgetSessionId: string; origin: string;
  }): Promise<{ ticket: string; expiresInMs: number; availability: WidgetVoiceAvailability }> {
    const availability = await this.availability(input.tenantId, input.assistantId);
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
      },
    }, input.origin);
    return { ...issued, availability };
  }

  private async enginesHealthy(): Promise<boolean> {
    const now = Date.now();
    if (this.health && now - this.health.at < HEALTH_CACHE_MS) return this.health.ok;
    this.probing ??= Promise.all([this.stt, this.tts, this.vad].map(async (port) => {
      try { return await port.healthCheck(); } catch { return false; }
    })).then((results) => results.every(Boolean)).then((ok) => {
      this.health = { at: Date.now(), ok };
      return ok;
    }).finally(() => { this.probing = undefined; });
    return this.probing;
  }
}
