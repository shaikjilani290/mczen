import { Controller, Get, Inject } from '@nestjs/common';
import { RequirePermission } from '../auth/auth.decorators';
import { SHARED_STATE, type SharedState } from '../shared-state/shared-state';
import { SPEECH_TO_TEXT, type SpeechToTextPort } from './stt/stt.port';
import { TEXT_TO_SPEECH, type TextToSpeechPort } from './tts/tts.port';
import { VOICE_ACTIVITY, type VoiceActivityPort } from './vad/vad.port';
import { MAX_GLOBAL_SESSIONS, MAX_SESSION_MS, MAX_TENANT_SESSIONS } from './voice-session.manager';

const LANGUAGES = ['en', 'hi', 'te'] as const;

/** Reports live provider health and real capabilities; nothing is hardcoded as "healthy". */
@Controller('api/voice')
export class VoiceCapabilitiesController {
  constructor(
    @Inject(SPEECH_TO_TEXT) private readonly stt: SpeechToTextPort,
    @Inject(TEXT_TO_SPEECH) private readonly tts: TextToSpeechPort,
    @Inject(VOICE_ACTIVITY) private readonly vad: VoiceActivityPort,
    @Inject(SHARED_STATE) private readonly store: SharedState,
  ) {}

  @Get('capabilities')
  @RequirePermission('assistants:read')
  async capabilities() {
    const [stt, tts, vad] = await Promise.all([this.stt, this.tts, this.vad].map(async (port) => {
      try { return await port.healthCheck(); } catch { return false; }
    }));
    return {
      protocol: 'mczen-voice.v1',
      providers: {
        stt: { engine: this.stt.engineId, healthy: stt, ...this.stt.status?.() },
        tts: { engine: this.tts.engineId, healthy: tts },
        vad: { engine: this.vad.engineId, healthy: vad },
      },
      languages: LANGUAGES.map((language) => ({
        language,
        recognition: true,
        speech: this.tts.supports(language),
        textOnly: !this.tts.supports(language),
        voices: this.tts.voices(language),
      })),
      limits: {
        maxSessionsPerTenant: MAX_TENANT_SESSIONS,
        maxSessionsPerUser: 1,
        maxSessionsPerInstance: MAX_GLOBAL_SESSIONS,
        maxSessionSeconds: MAX_SESSION_MS / 1000,
      },
      scaling: 'Tickets, rate limits, session concurrency slots and resume metadata use the shared store (see storage.driver). Live audio pipelines and sockets are per-instance: use sticky routing for /api/voice/stream; a resume that lands on another instance is rejected and the client starts a new session on the same conversation.',
      storage: { driver: this.store.driver },
    };
  }
}
