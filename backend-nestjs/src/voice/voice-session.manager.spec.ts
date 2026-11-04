import { WebSocket } from 'ws';
import { newUuidv7 } from '../common/ids/uuid';
import type { ConversationsService } from '../conversations/conversations.service';
import type { AgentResponse } from '../agent/agent.service';
import type { AgentInvocationPort } from './agent-invocation.port';
import type { VoiceAuthService, VoiceIdentity } from './voice-auth.service';
import type { VoiceSessionRepository } from './voice-session.repository';
import type { SpeechToTextPort } from './stt/stt.port';
import type { VoiceActivityPort } from './vad/vad.port';
import type { TextToSpeechPort } from './tts/tts.port';
import type { VoiceSettings } from './voice.types';
import { VoiceSessionManager } from './voice-session.manager';
import { MemorySharedState } from '../shared-state/memory-shared-state';
import { SharedStateUnavailableError } from '../shared-state/shared-state';

const settings: VoiceSettings = {
  sttEngineId: 'faster-whisper-small-int8',
  ttsEngineId: 'piper',
  sttLanguageHint: 'auto',
  ttsVoice: 'en_US-amy-medium',
  ttsVoiceFallback: null,
  speechRate: 1,
  vadSensitivity: 0.5,
  endpointSilenceMs: 700,
  minSpeechMs: 80,
  silenceNudgeMs: 10_000,
  bargeInEnabled: true,
  idleTimeoutMs: 300_000,
};

function frame(sequence: number, epoch = 1, payloadBytes = 640): Buffer {
  const payload = Buffer.alloc(payloadBytes);
  const result = Buffer.alloc(11 + payload.length);
  result.writeUInt8(1, 0);
  result.writeUInt32BE(epoch, 1);
  result.writeUInt32BE(sequence, 5);
  result.writeUInt16BE(payload.length, 9);
  payload.copy(result, 11);
  return result;
}

function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for voice event.'));
      setTimeout(poll, 5);
    };
    poll();
  });
}

describe('VoiceSessionManager', () => {
  let manager: VoiceSessionManager;
  let makeManager: () => VoiceSessionManager;
  let store: MemorySharedState;
  let socket: WebSocket;
  let sentEvents: Array<Record<string, unknown>>;
  let identity: VoiceIdentity;
  let assistantId: string;
  let stt: jest.Mocked<SpeechToTextPort>;
  let vad: jest.Mocked<VoiceActivityPort>;
  let tts: jest.Mocked<TextToSpeechPort>;
  let agent: jest.Mocked<AgentInvocationPort>;
  let persistence: jest.Mocked<VoiceSessionRepository>;
  let conversations: jest.Mocked<ConversationsService>;
  let initialSocketClose: jest.Mock;
  let persistenceEvent: jest.Mock;
  let agentInvoke: jest.Mock;
  let sttTranscribe: jest.Mock;
  let conversationCreate: jest.Mock;

  beforeEach(() => {
    store = new MemorySharedState();
    const tenantId = newUuidv7();
    const userId = newUuidv7();
    assistantId = newUuidv7();
    identity = { tenantId, userId, sessionId: newUuidv7(), permissions: ['conversations:write'] };
    sentEvents = [];
    initialSocketClose = jest.fn();
    socket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: jest.fn((value: string | Buffer) => {
        if (typeof value === 'string') sentEvents.push(JSON.parse(value) as Record<string, unknown>);
      }),
      close: initialSocketClose,
    } as unknown as WebSocket;

    let vadCalls = 0;
    sttTranscribe = jest.fn().mockResolvedValue({
      text: 'Hello McZEN.',
      language: 'en',
      confidence: 0.99,
      isFinal: true,
    });
    stt = {
      engineId: 'faster-whisper-small-int8',
      healthCheck: jest.fn().mockResolvedValue(true),
      transcribe: sttTranscribe,
    };
    vad = {
      engineId: 'silero-vad',
      healthCheck: jest.fn().mockResolvedValue(true),
      detect: jest.fn().mockImplementation(async () => ({
        speech: ++vadCalls <= 5,
        probability: 0.99,
      })),
    };
    tts = {
      engineId: 'piper',
      supports: jest.fn().mockReturnValue(true),
      supportsVoice: jest.fn((language, voice) =>
        language === 'en' ? voice === 'en_US-amy-medium' : language === 'hi' && voice === 'hi_IN-pratham-medium'),
      voices: jest.fn((language) => language === 'te' ? [] : [{
        id: language === 'hi' ? 'hi_IN-pratham-medium' : 'en_US-amy-medium',
        label: language === 'hi' ? 'Pratham' : 'Amy',
        gender: language === 'hi' ? 'male' : 'female',
        language,
      }]),
      healthCheck: jest.fn().mockResolvedValue(true),
      synthesize: jest.fn().mockImplementation(async function* () {
        yield { encoding: 'pcm_s16le', sampleRate: 16000, data: Buffer.alloc(640) };
      }),
    };
    const response: AgentResponse = {
      success: true,
      answer: 'Hello there.',
      model: 'test-model',
      toolCalls: [{ name: 'knowledge.search', resultCount: 1 }],
      sources: [{ id: 'source-1', title: 'Help', source: 'knowledge' }],
    };
    agentInvoke = jest.fn().mockResolvedValue(response);
    agent = { invoke: agentInvoke };
    persistenceEvent = jest.fn().mockResolvedValue(undefined);
    persistence = {
      create: jest.fn().mockResolvedValue(undefined),
      event: persistenceEvent,
      updateConversation: jest.fn().mockResolvedValue(undefined),
      updateState: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VoiceSessionRepository>;
    conversationCreate = jest.fn().mockResolvedValue(newUuidv7());
    const conversationsService = {
      create: conversationCreate,
      prepareAgentTurn: jest.fn().mockResolvedValue({ assistantId }),
    };
    conversations = conversationsService as unknown as jest.Mocked<ConversationsService>;
    const auth = {
      resolveSettings: jest.fn().mockResolvedValue({
        settings,
        allowedLanguages: ['en', 'hi'],
        ttsLanguages: ['en', 'hi'],
        defaultLanguage: 'en',
      }),
      resolveLanguageVoice: jest.fn().mockResolvedValue({
        enabled: true,
        voice: 'en_US-amy-medium',
        rate: 1,
      }),
    } as unknown as VoiceAuthService;
    makeManager = () => new VoiceSessionManager(auth, persistence, conversations, stt, vad, tts, agent, store);
    manager = makeManager();
  });

  afterEach(async () => {
    await manager.closeAll();
  });

  async function beginSession() {
    await manager.begin(socket, identity, { assistantId }, 'Chrome/123');
    const started = sentEvents.find((event) => event.type === 'voice.session.started');
    expect(started).toBeDefined();
    expect((started?.data as Record<string, unknown>).settings).toEqual(expect.objectContaining({
      voices: expect.objectContaining({
        en: expect.arrayContaining([expect.objectContaining({ gender: 'female' })]),
        te: [],
      }),
    }));
    return String(started?.sessionId);
  }

  it('validates tenant-controlled events and binds the session to its authenticated socket', async () => {
    const sessionId = await beginSession();

    await manager.handleText(socket, JSON.stringify({
      v: 1,
      type: 'voice.assistant.interrupt',
      ts: new Date().toISOString(),
      sessionId,
      data: { tenantId: newUuidv7() },
    }));

    expect(sentEvents.some((event) => (event.data as Record<string, unknown>)?.code === 'PROTO_VIOLATION')).toBe(true);
    const foreignSocketClose = jest.fn();
    const foreignSocket = { readyState: WebSocket.OPEN, send: jest.fn(), close: foreignSocketClose } as unknown as WebSocket;
    await manager.handleText(foreignSocket, JSON.stringify({
      v: 1,
      type: 'voice.session.close',
      ts: new Date().toISOString(),
      sessionId,
      data: {},
    }));
    expect(foreignSocketClose).toHaveBeenCalledWith(4404, 'SESSION_MISMATCH');
  });

  it('closes after five malformed audio frames within the violation window', async () => {
    await beginSession();
    for (let index = 0; index < 5; index++) manager.handleBinary(socket, Buffer.from([0]));

    expect(initialSocketClose).toHaveBeenCalledWith(4410, 'PROTOCOL_VIOLATION');
    expect(persistenceEvent).toHaveBeenCalledTimes(5);
  });

  it('limits each authenticated user to one live session', async () => {
    await beginSession();
    const secondSocketClose = jest.fn();
    const secondSocket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: jest.fn(),
      close: secondSocketClose,
    } as unknown as WebSocket;

    await manager.begin(secondSocket, identity, { assistantId }, 'Chrome/123');

    expect(secondSocketClose).toHaveBeenCalledWith(4409, 'SESSION_LIMIT_REACHED');
    expect(manager.activeSessionCount).toBe(1);
  });

  it('resumes with a single-use token bound to the authenticated tenant and user', async () => {
    const sessionId = await beginSession();
    const tokenEvent = sentEvents.find((event) => event.type === 'voice.session.resume_token');
    const token = (tokenEvent?.data as Record<string, unknown>)?.token;
    expect(typeof token).toBe('string');
    manager.onDisconnect(socket);

    const wrongIdentitySocketClose = jest.fn();
    const wrongIdentitySocket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: jest.fn(),
      close: wrongIdentitySocketClose,
    } as unknown as WebSocket;
    await manager.begin(wrongIdentitySocket, { ...identity, userId: newUuidv7() }, {
      assistantId,
      resumeToken: token,
      lastEpoch: 1,
    });
    expect(wrongIdentitySocketClose).toHaveBeenCalledWith(4404, 'SESSION_MISMATCH');

    const resumedSocket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: jest.fn((value: string) => sentEvents.push(JSON.parse(value) as Record<string, unknown>)),
      close: jest.fn(),
    } as unknown as WebSocket;
    await manager.begin(resumedSocket, identity, {
      assistantId,
      resumeToken: token,
      lastEpoch: 1,
    });
    expect(sentEvents.some((event) =>
      event.type === 'voice.session.resumed' && event.sessionId === sessionId,
    )).toBe(true);

    const replaySocketClose = jest.fn();
    const replaySocket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: jest.fn(),
      close: replaySocketClose,
    } as unknown as WebSocket;
    await manager.begin(replaySocket, identity, {
      assistantId,
      resumeToken: token,
      lastEpoch: 1,
    });
    expect(replaySocketClose).toHaveBeenCalledWith(4404, 'SESSION_MISMATCH');
  });

  function fakeSocket() {
    const events: Array<Record<string, unknown>> = [];
    const close = jest.fn();
    const ws = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 0,
      send: jest.fn((value: string | Buffer) => {
        if (typeof value === 'string') events.push(JSON.parse(value) as Record<string, unknown>);
      }),
      close,
    } as unknown as WebSocket;
    return { ws, events, close };
  }

  function widgetIdentity(): VoiceIdentity {
    const conversationId = newUuidv7();
    return {
      tenantId: identity.tenantId,
      userId: '',
      sessionId: newUuidv7(),
      permissions: ['knowledge:read'],
      widget: { assistantId, conversationId, widgetSessionId: newUuidv7() },
    };
  }

  it('forces the assistant and conversation from a widget ticket and rejects mismatches', async () => {
    const widgetId = widgetIdentity();
    const bad = fakeSocket();
    await manager.begin(bad.ws, widgetId, { assistantId: newUuidv7() });
    expect(bad.close).toHaveBeenCalledWith(4410, 'INVALID_SESSION_START');
    const badConversation = fakeSocket();
    await manager.begin(badConversation.ws, widgetId, { conversationId: newUuidv7() });
    expect(badConversation.close).toHaveBeenCalledWith(4410, 'INVALID_SESSION_START');

    const good = fakeSocket();
    await manager.begin(good.ws, widgetId, { language: 'en' });
    expect(good.events.some((event) => event.type === 'voice.session.started')).toBe(true);
    expect(conversationCreate).not.toHaveBeenCalled();
  });

  it('enforces per-visitor and per-tenant limits across managers that share one store', async () => {
    const other = makeManager();
    try {
      const widgetId = widgetIdentity();
      const first = fakeSocket();
      await manager.begin(first.ws, widgetId, {});
      const duplicate = fakeSocket();
      await other.begin(duplicate.ws, widgetId, {});
      expect(duplicate.close).toHaveBeenCalledWith(4409, 'SESSION_LIMIT_REACHED');

      // Two more distinct visitors fill the tenant limit of three; the fourth is refused.
      for (let index = 0; index < 2; index++) {
        const visitor = fakeSocket();
        await other.begin(visitor.ws, widgetIdentity(), {});
        expect(visitor.events.some((event) => event.type === 'voice.session.started')).toBe(true);
      }
      const overflow = fakeSocket();
      await manager.begin(overflow.ws, widgetIdentity(), {});
      expect(overflow.close).toHaveBeenCalledWith(4409, 'SESSION_LIMIT_REACHED');
    } finally {
      await other.closeAll();
    }
  });

  it('releases shared slots when a session closes so the visitor can start again', async () => {
    const other = makeManager();
    try {
      const widgetId = widgetIdentity();
      const first = fakeSocket();
      await manager.begin(first.ws, widgetId, {});
      await manager.closeAll();
      const again = fakeSocket();
      await other.begin(again.ws, widgetId, {});
      expect(again.events.some((event) => event.type === 'voice.session.started')).toBe(true);
    } finally {
      await other.closeAll();
    }
  });

  it('refuses to resume a session owned by another instance and fails safely', async () => {
    const sessionId = await beginSession();
    const token = String((sentEvents.find((event) => event.type === 'voice.session.resume_token')?.data as Record<string, unknown>).token);
    manager.onDisconnect(socket);
    const other = makeManager();
    try {
      const attempt = fakeSocket();
      await other.begin(attempt.ws, identity, { assistantId, resumeToken: token, lastEpoch: 1 });
      expect(attempt.close).toHaveBeenCalledWith(4404, 'SESSION_MISMATCH');
      expect(attempt.events.some((event) => event.type === 'voice.session.resumed')).toBe(false);
      expect(sessionId).toBeTruthy();
    } finally {
      await other.closeAll();
    }
  });

  it('fails closed with 4503 when shared state is unavailable', async () => {
    jest.spyOn(store, 'acquireSlot').mockRejectedValue(new SharedStateUnavailableError());
    const down = fakeSocket();
    await manager.begin(down.ws, identity, { assistantId });
    expect(down.close).toHaveBeenCalledWith(4503, 'VOICE_SESSION_UNAVAILABLE');
    expect(manager.activeSessionCount).toBe(0);
  });
  it('persists voice modality and emits the agent response contract through a completed turn', async () => {
    await beginSession();
    for (let index = 0; index < 40; index++) manager.handleBinary(socket, frame(index));

    await waitFor(() => sentEvents.some((event) => event.type === 'voice.assistant.turn.end'));
    expect(agentInvoke).toHaveBeenCalledWith(
      'Hello McZEN.',
      expect.objectContaining({ modality: 'voice', language: 'en', tenantId: identity.tenantId }),
      expect.any(AbortSignal),
    );
    const responseEvent = sentEvents.find((event) => event.type === 'voice.assistant.response');
    expect(responseEvent?.data).toEqual(expect.objectContaining({
      success: true,
      answer: 'Hello there.',
      model: 'test-model',
      toolCalls: [{ name: 'knowledge.search', resultCount: 1 }],
      sources: [{ id: 'source-1', title: 'Help', source: 'knowledge' }],
    }));
    expect(sttTranscribe).toHaveBeenCalledWith(expect.objectContaining({
      language: 'auto',
      partial: false,
    }));
    expect(conversationCreate).toHaveBeenCalledWith(expect.objectContaining({ channel: 'voice' }));
  });

  it('keeps processing microphone frames while final transcription is pending', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    sttTranscribe.mockImplementation(async () => {
      await pending;
      return { text: 'Hello McZEN.', language: 'en', isFinal: true };
    });
    let calls = 0;
    vad.detect.mockImplementation(async () => ({ speech: ++calls <= 4, probability: 0.99 }));
    await beginSession();
    try {
      for (let index = 0; index < 39; index++) manager.handleBinary(socket, frame(index));
      await waitFor(() => sttTranscribe.mock.calls.length > 0);
      expect(sentEvents.some((event) => event.type === 'voice.assistant.thinking' &&
        (event.data as Record<string, unknown>)?.hint === 'transcribing')).toBe(true);
      manager.handleBinary(socket, frame(39));
      await waitFor(() => calls === 40);
      expect(sentEvents.some((event) => (event.data as Record<string, unknown>)?.code === 'INGRESS_BACKPRESSURE')).toBe(false);
    } finally {
      release?.();
    }
    await waitFor(() => sentEvents.some((event) => event.type === 'voice.assistant.turn.end'));
  });

  it('bounds captions, keeps one preview in flight, and cancels it for final transcription', async () => {
    let releasePreview: (() => void) | undefined;
    const preview = new Promise<void>((resolve) => { releasePreview = resolve; });
    sttTranscribe.mockImplementation(async (request: { partial: boolean }) => {
      if (request.partial) await preview;
      return { text: 'Hello McZEN.', language: 'en', isFinal: !request.partial };
    });
    let calls = 0;
    vad.detect.mockImplementation(async () => ({ speech: ++calls <= 159, probability: 0.99 }));
    const sessionId = await beginSession();
    try {
      for (let index = 0; index < 8; index++) {
        manager.handleBinary(socket, frame(index, 1, 12800));
        await waitFor(() => calls >= (index + 1) * 20);
      }
      await waitFor(() => sttTranscribe.mock.calls.length === 1);
      const request = sttTranscribe.mock.calls[0][0] as {
        audio: { data: Buffer }; partial: boolean; signal: AbortSignal;
      };
      expect(request.partial).toBe(true);
      expect(request.audio.data.length).toBe(96_000);
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 2_000);
      try {
        manager.handleBinary(socket, frame(8, 1, 12800));
        await waitFor(() => calls === 180);
        expect(sttTranscribe).toHaveBeenCalledTimes(1);
        expect(request.signal.aborted).toBe(false);
      } finally {
        clock.mockRestore();
      }
      await manager.handleText(socket, JSON.stringify({
        v: 1, type: 'voice.audio.end', ts: new Date().toISOString(), sessionId, data: {},
      }));
      expect(request.signal.aborted).toBe(true);
      const final = sttTranscribe.mock.calls.find(([input]) => !input.partial)?.[0] as {
        audio: { data: Buffer }; partial: boolean;
      };
      expect(final.partial).toBe(false);
      expect(final.audio.data.length).toBeGreaterThan(96_000);
    } finally {
      releasePreview?.();
    }
    await waitFor(() => sentEvents.some((event) => event.type === 'voice.assistant.turn.end'));
    expect(sentEvents.some((event) => event.type === 'voice.transcript.partial')).toBe(false);
  });

  it('aborts stale TTS on interruption and never emits an old-epoch audio end', async () => {
    let ttsSignal: AbortSignal | undefined;
    tts.synthesize.mockImplementation(async function* (request) {
      ttsSignal = request.signal;
      yield { encoding: 'pcm_s16le', sampleRate: 16000, data: Buffer.alloc(640) };
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) return resolve();
        request.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      yield { encoding: 'pcm_s16le', sampleRate: 16000, data: Buffer.alloc(640) };
    });

    const sessionId = await beginSession();
    for (let index = 0; index < 40; index++) manager.handleBinary(socket, frame(index));
    await waitFor(() => sentEvents.some((event) => event.type === 'voice.assistant.audio.chunk'));
    await manager.handleText(socket, JSON.stringify({
      v: 1,
      type: 'voice.assistant.interrupt',
      ts: new Date().toISOString(),
      sessionId,
      data: {},
    }));
    await waitFor(() => ttsSignal?.aborted === true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ttsSignal?.aborted).toBe(true);
    expect(sentEvents.some((event) => event.type === 'voice.assistant.interrupt')).toBe(true);
    expect(sentEvents.some((event) => event.type === 'voice.assistant.audio.end')).toBe(false);
  });
});
