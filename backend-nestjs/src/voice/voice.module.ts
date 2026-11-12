import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AgentInvocationAdapter } from './agent-invocation.adapter';
import { AGENT_INVOCATION } from './agent-invocation.port';
import { FasterWhisperAdapter } from './stt/faster-whisper.adapter';
import { ConfiguredSttAdapter } from './stt/configured-stt.adapter';
import { SPEECH_TO_TEXT } from './stt/stt.port';
import { SileroVadAdapter } from './vad/silero-vad.adapter';
import { VOICE_ACTIVITY } from './vad/vad.port';
import { PiperAdapter } from './tts/piper.adapter';
import { DhvaaniAdapter } from './tts/dhvaani.adapter';
import { CompositeTtsAdapter } from './tts/composite-tts.adapter';
import { TEXT_TO_SPEECH } from './tts/tts.port';
import { VoiceAuthService } from './voice-auth.service';
import { VoiceGateway } from './voice.gateway';
import { VoiceSessionManager } from './voice-session.manager';
import { VoiceSessionRepository } from './voice-session.repository';
import { VoiceTicketController } from './voice-ticket.controller';
import { VoiceCapabilitiesController } from './voice-capabilities.controller';
import { VoiceTicketService } from './voice-ticket.service';
import { WidgetVoiceService } from './widget-voice.service';
import { VoiceLibraryService } from './voice-library.service';
import { VoiceLibraryController } from './voice-library.controller';
import { WebsiteDataModule } from '../website-integrations/website-data.module';

@Module({
  imports: [AgentModule, AuthModule, ConversationsModule, WebsiteDataModule],
  controllers: [VoiceTicketController, VoiceCapabilitiesController, VoiceLibraryController],
  exports: [WidgetVoiceService],
  providers: [
    VoiceLibraryService,
    WidgetVoiceService,
    VoiceAuthService,
    VoiceSessionRepository,
    VoiceTicketService,
    VoiceSessionManager,
    VoiceGateway,
    FasterWhisperAdapter,
    ConfiguredSttAdapter,
    SileroVadAdapter,
    PiperAdapter,
    DhvaaniAdapter,
    CompositeTtsAdapter,
    AgentInvocationAdapter,
    { provide: SPEECH_TO_TEXT, useExisting: ConfiguredSttAdapter },
    { provide: VOICE_ACTIVITY, useExisting: SileroVadAdapter },
    { provide: TEXT_TO_SPEECH, useExisting: CompositeTtsAdapter },
    { provide: AGENT_INVOCATION, useExisting: AgentInvocationAdapter },
  ],
})
export class VoiceModule {}
