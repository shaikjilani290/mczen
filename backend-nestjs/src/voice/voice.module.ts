import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AgentInvocationAdapter } from './agent-invocation.adapter';
import { AGENT_INVOCATION } from './agent-invocation.port';
import { FasterWhisperAdapter } from './stt/faster-whisper.adapter';
import { SPEECH_TO_TEXT } from './stt/stt.port';
import { SileroVadAdapter } from './vad/silero-vad.adapter';
import { VOICE_ACTIVITY } from './vad/vad.port';
import { PiperAdapter } from './tts/piper.adapter';
import { TEXT_TO_SPEECH } from './tts/tts.port';
import { VoiceAuthService } from './voice-auth.service';
import { VoiceGateway } from './voice.gateway';
import { VoiceSessionManager } from './voice-session.manager';
import { VoiceSessionRepository } from './voice-session.repository';
import { VoiceTicketController } from './voice-ticket.controller';
import { VoiceCapabilitiesController } from './voice-capabilities.controller';
import { VoiceTicketService } from './voice-ticket.service';
import { WidgetVoiceService } from './widget-voice.service';

@Module({
  imports: [AgentModule, AuthModule, ConversationsModule],
  controllers: [VoiceTicketController, VoiceCapabilitiesController],
  exports: [WidgetVoiceService],
  providers: [
    WidgetVoiceService,
    VoiceAuthService,
    VoiceSessionRepository,
    VoiceTicketService,
    VoiceSessionManager,
    VoiceGateway,
    FasterWhisperAdapter,
    SileroVadAdapter,
    PiperAdapter,
    AgentInvocationAdapter,
    { provide: SPEECH_TO_TEXT, useExisting: FasterWhisperAdapter },
    { provide: VOICE_ACTIVITY, useExisting: SileroVadAdapter },
    { provide: TEXT_TO_SPEECH, useExisting: PiperAdapter },
    { provide: AGENT_INVOCATION, useExisting: AgentInvocationAdapter },
  ],
})
export class VoiceModule {}
