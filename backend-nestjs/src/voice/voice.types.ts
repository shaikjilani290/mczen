import type { AgentExecutionContext } from '../agent/context/agent-execution-context.interface';
import type { WebSocket } from 'ws';
import type { TtsVoiceOption } from './tts/tts.port';

export type VoiceLanguage = 'en' | 'hi' | 'te';
export type RequestedVoiceLanguage = VoiceLanguage | 'auto';
export type VoiceState =
  | 'idle'
  | 'listening'
  | 'detecting_end_of_speech'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error'
  | 'closed';

export interface VoiceSettings {
  sttEngineId: string;
  ttsEngineId: string;
  sttLanguageHint: RequestedVoiceLanguage;
  ttsVoice: string | null;
  ttsVoiceFallback: string | null;
  speechRate: number;
  vadSensitivity: number;
  endpointSilenceMs: number;
  minSpeechMs: number;
  silenceNudgeMs: number;
  bargeInEnabled: boolean;
  idleTimeoutMs: number;
}

export interface VerifiedVoiceContext {
  agent: AgentExecutionContext;
  permissions: readonly string[];
  sessionId: string;
  assistantId: string;
  /** Set for anonymous widget sessions; identifies the visitor session instead of a user. */
  widgetSessionId?: string;
  conversationId?: string;
  language: RequestedVoiceLanguage;
  allowedLanguages: readonly VoiceLanguage[];
  defaultLanguage: VoiceLanguage;
  voiceOptions: Readonly<Record<VoiceLanguage, readonly TtsVoiceOption[]>>;
  settings: VoiceSettings;
}

export interface VoiceSession {
  readonly id: string;
  readonly context: VerifiedVoiceContext;
  socket?: WebSocket;
  readonly startedAt: number;
  state: VoiceState;
  epoch: number;
  incomingSequence?: number;
  outgoingSequence: number;
  audioBytes: number;
  currentAudio: Buffer[];
  preRoll: Buffer[];
  audioQueue: Buffer[];
  audioProcessing: boolean;
  currentAudioBytes: number;
  pendingAudioBytes: number;
  processing: Promise<void>;
  recentFrameTimes: number[];
  recentEventTimes: number[];
  recentViolationTimes: number[];
  vadPending: Buffer;
  speechMs: number;
  silenceMs: number;
  turnsCompleted: number;
  interrupts: number;
  listenMs: number;
  speakMs: number;
  speakingStartedAt?: number;
  utteranceStartedAt?: number;
  lastActivityAt: number;
  turnId?: string;
  turnAbort?: AbortController;
  ttsAbort?: AbortController;
  sttAbort?: AbortController;
  partialAbort?: AbortController;
  resumeTokenHash?: string;
  slotTimer?: ReturnType<typeof setInterval>;
  /** Shared-state slot scopes held by this session; released on close. */
  slotScopes?: readonly string[];
  closeTimer?: ReturnType<typeof setTimeout>;
  sessionTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastPartialAt?: number;
  lastNudgeAt?: number;
}

export interface VoiceEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  v: 1;
  type: string;
  ts: string;
  sessionId?: string;
  epoch?: number;
  data?: T;
}

export interface VoiceAudioFrame {
  type: 1 | 2;
  epoch: number;
  sequence: number;
  payload: Buffer;
}
