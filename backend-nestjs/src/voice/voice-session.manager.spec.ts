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
import { VoiceProviderError } from './voice-provider.util';
import { ConfiguredSttAdapter } from './stt/configured-stt.adapter';
import { FasterWhisperAdapter } from './stt/faster-whisper.adapter';

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
  let makeManager: (sttPort?: SpeechToTextPort) => VoiceSessionManager;
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
      products: [{
        externalProductId: 'merchant-1', name: 'Tea', productUrl: 'https://shop.example/tea',
        images: ['https://shop.example/tea.jpg'], price: 2500, salePrice: 1800, currency: 'INR',
      }],
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
    makeManager = (sttPort = stt) => new VoiceSessionManager(auth, persistence, conversations, sttPort, vad, tts, agent, store);
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

  it.each(['remote', 'fallback', 'both_failed'] as const)(
    'routes binary voice audio through configured STT to agent/events: %s (providers mocked)',
    async outcome => {
      const keys = ['MCZEN_STT_PROVIDER', 'MCZEN_STT_URL', 'MCZEN_STT_API_KEY',
        'MCZEN_STT_TIMEOUT_MS', 'MCZEN_STT_FALLBACK_ENABLED'] as const;
      const previous = keys.map(key => process.env[key]);
      process.env.MCZEN_STT_PROVIDER = 'remote';
      process.env.MCZEN_STT_URL = 'https://paperspace.example';
      process.env.MCZEN_STT_API_KEY = 'synthetic-test-key';
      process.env.MCZEN_STT_TIMEOUT_MS = '30000';
      process.env.MCZEN_STT_FALLBACK_ENABLED = 'true';
      const local = new FasterWhisperAdapter();
      const localTranscribe = jest.spyOn(local, 'transcribe').mockImplementation(sttTranscribe);
      const localHealth = jest.spyOn(local, 'healthCheck').mockResolvedValue(true);
      const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        if (!(url instanceof URL)) throw new Error('Expected provider URL.');
        if (url.pathname === '/health') return new Response('{}');
        if (outcome !== 'remote') return new Response('', { status: 401 });
        return new Response(JSON.stringify({
          success: true, transcript: 'Hello McZEN.', language: 'en',
          audio_duration: 0.8, processing_time: 0.43, speed: 1.86,
          device: 'cuda', model: 'small', compute_type: 'int8',
        }));
      });
      if (outcome === 'both_failed') {
        localTranscribe.mockRejectedValue(new VoiceProviderError('VOICE_ENGINE_UNAVAILABLE'));
      }
      try {
        manager = makeManager(new ConfiguredSttAdapter(local));
        const sessionId = await beginSession();
        for (let index = 0; index < 8; index++) {
          manager.handleBinary(socket, frame(index, 1, 3200));
          await waitFor(() => vad.detect.mock.calls.length >= (index + 1) * 5);
        }
        if (outcome === 'both_failed') {
          await waitFor(() => sentEvents.some(event => event.type === 'voice.session.error'));
          expect(sentEvents.find(event => event.type === 'voice.session.error')?.data)
            .toEqual(expect.objectContaining({ code: 'STT_UNAVAILABLE' }));
          expect(agentInvoke).not.toHaveBeenCalled();
          expect(sentEvents.some(event => event.type === 'voice.transcript.final')).toBe(false);
        } else {
          await waitFor(() => sentEvents.some(event => event.type === 'voice.assistant.turn.end'));
          const final = sentEvents.find(event => event.type === 'voice.transcript.final');
          if (!final || typeof final.data !== 'object' || !final.data) throw new Error('Expected final transcript.');
          const data = final.data as Record<string, unknown>;
          expect(final.sessionId).toBe(sessionId);
          expect(data.text).toBe('Hello McZEN.');
          expect(agentInvoke).toHaveBeenCalledWith('Hello McZEN.',
            expect.objectContaining({ requestId: data.turnId, modality: 'voice' }), expect.any(AbortSignal));
          const call = fetch.mock.calls.find(([url]) => url instanceof URL && url.pathname === '/transcribe');
          expect(call?.[1]?.headers).toEqual(expect.objectContaining({ 'x-mczen-request-id': data.turnId }));
          expect(sentEvents.find(event => event.type === 'voice.assistant.response')?.sessionId).toBe(sessionId);
          if (outcome === 'remote') {
            expect(data.sttProcessingMs).toBe(430);
            expect(localTranscribe).not.toHaveBeenCalled();
          }
        }
        if (outcome !== 'remote') expect(localTranscribe).toHaveBeenCalledTimes(1);
      } finally {
        await manager.closeAll();
        fetch.mockRestore();
        localTranscribe.mockRestore();
        localHealth.mockRestore();
        keys.forEach((key, index) => {
          if (previous[index] === undefined) delete process.env[key];
          else process.env[key] = previous[index];
        });
      }
    },
  );

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

  it('starts sequence validation afresh per epoch but still reports gaps within an epoch', async () => {
    vad.detect.mockResolvedValue({ speech: false, probability: 0 });
    const sessionId = await beginSession();
    manager.handleBinary(socket, frame(0));
    await manager.handleText(socket, JSON.stringify({
      v: 1, type: 'voice.assistant.interrupt', ts: new Date().toISOString(), sessionId, data: {},
    }));
    manager.handleBinary(socket, frame(1, 1));
    manager.handleBinary(socket, frame(2, 1));
    manager.handleBinary(socket, frame(3, 2));
    expect(sentEvents.some((e) => (e.data as Record<string, unknown>)?.code === 'SEQUENCE_GAP')).toBe(false);
    manager.handleBinary(socket, frame(5, 2));
    expect(sentEvents.filter((e) => (e.data as Record<string, unknown>)?.code === 'SEQUENCE_GAP')).toHaveLength(1);
  });

  it('keeps the existing 40 audio frames per second limit', async () => {
    vad.detect.mockResolvedValue({ speech: false, probability: 0 });
    await beginSession();
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      for (let i = 0; i < 41; i++) manager.handleBinary(socket, frame(i));
      expect(initialSocketClose).toHaveBeenCalledWith(4429, 'RATE_LIMITED');
    } finally {
      now.mockRestore();
    }
  });

  it('reports a live audio-processing timeout without claiming all speech services are down', async () => {
    vad.detect.mockRejectedValueOnce(new VoiceProviderError('VOICE_PROVIDER_TIMEOUT'));
    await beginSession();
    manager.handleBinary(socket, frame(0));
    await waitFor(() => sentEvents.some((e) => (e.data as Record<string, unknown>)?.code === 'VOICE_AUDIO_PROCESSING_FAILED'));
    expect(sentEvents.some((e) => (e.data as Record<string, unknown>)?.code === 'VOICE_ENGINE_UNAVAILABLE')).toBe(false);
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
    manager.handleBinary(socket, frame(0));
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
    manager.handleBinary(resumedSocket, frame(5, 2));
    expect(sentEvents.some((event) => (event.data as Record<string, unknown>)?.code === 'SEQUENCE_GAP')).toBe(false);

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

  it('replaces only a disconnected widget session belonging to the same verified conversation', async () => {
    const visitor = widgetIdentity();
    const first = fakeSocket();
    await manager.begin(first.ws, visitor, {});
    manager.onDisconnect(first.ws);
    const replacement = fakeSocket();
    await manager.begin(replacement.ws, visitor, {});
    expect(replacement.events.some(event => event.type === 'voice.session.started')).toBe(true);
    expect(manager.activeSessionCount).toBe(1);
    expect(persistence.close).toHaveBeenCalledWith(expect.anything(), 'disconnected_session_replaced', null);
    const started = replacement.events.find(event => event.type === 'voice.session.started');
    expect((started?.data as { settings: { conversationId: string } }).settings.conversationId)
      .toBe(visitor.widget?.conversationId);
  });

  it('does not replace an active socket or a disconnected visitor on a different conversation', async () => {
    const visitor = widgetIdentity();
    const first = fakeSocket();
    await manager.begin(first.ws, visitor, {});
    const activeDuplicate = fakeSocket();
    await manager.begin(activeDuplicate.ws, visitor, {});
    expect(activeDuplicate.close).toHaveBeenCalledWith(4409, 'SESSION_LIMIT_REACHED');
    manager.onDisconnect(first.ws);
    const wrongConversation = fakeSocket();
    await manager.begin(wrongConversation.ws, {
      ...visitor, widget: { ...visitor.widget!, conversationId: newUuidv7() },
    }, {});
    expect(wrongConversation.close).toHaveBeenCalledWith(4409, 'SESSION_LIMIT_REACHED');
    expect(manager.activeSessionCount).toBe(1);
    expect(persistence.close).not.toHaveBeenCalled();
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
      products: [{
        externalProductId: 'merchant-1', name: 'Tea', productUrl: 'https://shop.example/tea',
        images: ['https://shop.example/tea.jpg'], price: 2500, salePrice: 1800, currency: 'INR',
      }],
    }));
    expect(sttTranscribe).toHaveBeenCalledWith(expect.objectContaining({
      language: 'auto',
      partial: false,
    }));
    expect(conversationCreate).toHaveBeenCalledWith(expect.objectContaining({ channel: 'voice' }));
  });

  it('uses a distinct idempotency request ID per spoken turn while preserving the merchant session', async () => {
    const merchant = { integrationId: newUuidv7(), sessionId: 'merchant-visitor', origin: 'https://shop.example' };
    const widgetId = widgetIdentity();
    widgetId.widget!.merchant = merchant;
    widgetId.permissions = ['products:read'];
    await manager.begin(socket, widgetId, { language: 'en' });
    for (let turn = 0; turn < 2; turn++) {
      let calls = 0;
      vad.detect.mockImplementation(async () => ({ speech: ++calls <= 5, probability: 0.99 }));
      sttTranscribe.mockResolvedValue({ text: turn ? 'Add one more.' : 'Add this product to my cart.', language: 'en', isFinal: true });
      for (let index = 0; index < 40; index++) {
        manager.handleBinary(socket, frame(index, turn + 1));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await waitFor(() => sentEvents.filter(event => event.type === 'voice.assistant.epoch').length === turn + 1);
    }
    expect(agentInvoke).toHaveBeenCalledTimes(2);
    const contexts = agentInvoke.mock.calls.map(call => call[1]);
    expect(contexts[0].requestId).not.toBe(contexts[1].requestId);
    const completed = sentEvents.filter(event => event.type === 'voice.assistant.turn.end');
    for (let turn = 0; turn < 2; turn++) {
      expect(contexts[turn]).toEqual(expect.objectContaining({
        tenantId: widgetId.tenantId, assistantId, merchant, channel: 'widget', modality: 'voice',
        requestId: (completed[turn].data as Record<string, unknown>).turnId,
      }));
    }
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
      await waitFor(() => sentEvents.filter((e) => e.type === 'voice.audio.ack').length === 40);
      expect(sentEvents.filter((e) => e.type === 'voice.audio.ack')
        .map((e) => (e.data as Record<string, unknown>).sequence)).toEqual(Array.from({ length: 40 }, (_, i) => i));
      expect(sttTranscribe.mock.calls[0][0].audio.data.length).toBe(39 * 640);
      expect(sentEvents.some((event) => (event.data as Record<string, unknown>)?.code === 'INGRESS_BACKPRESSURE')).toBe(false);
    } finally {
      release?.();
    }
    await waitFor(() => sentEvents.some((event) => event.type === 'voice.assistant.turn.end'));
  });

  it('does not acknowledge or leak a session when persistence completes after startup cancellation', async () => {
    let release!: () => void;
    persistence.create.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const startup = new AbortController();
    const beginning = manager.begin(socket, identity, { assistantId }, undefined, startup.signal);
    const rejected = expect(beginning).rejects.toThrow('Voice startup cancelled.');
    await waitFor(() => persistence.create.mock.calls.length === 1);
    startup.abort();
    release();
    await rejected;
    expect(manager.activeSessionCount).toBe(0);
    expect(persistence.close).toHaveBeenCalledWith(expect.anything(), 'startup_cancelled', null);
    expect(sentEvents.some((event) => event.type === 'voice.session.started')).toBe(false);
    persistence.create.mockResolvedValue(undefined);
    await beginSession();
  });

  it('pauses and resumes ingress for a slow VAD without reordering or dropping packets', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const received: number[] = [];
    vad.detect.mockImplementation(async (request) => {
      received.push(request.audio.data[0]);
      if (received.length === 1) await pending;
      return { speech: false, probability: 0 };
    });

    await beginSession();
    try {
      for (let i = 0; i < 6; i++) {
        const packet = frame(i, 1, 3200);
        packet.fill(i, 11);
        manager.handleBinary(socket, packet);
      }
      expect(sentEvents.some((e) => e.type === 'voice.audio.flow' &&
        (e.data as Record<string, unknown>).paused === true)).toBe(true);
      expect(sentEvents.filter((e) => e.type === 'voice.audio.ack')).toHaveLength(0);
      release();
      await waitFor(() => sentEvents.filter((e) => e.type === 'voice.audio.ack').length === 6);
      expect(received).toEqual(Array.from({ length: 30 }, (_, i) => Math.floor(i / 5)));
      const lastAck = sentEvents.filter((e) => e.type === 'voice.audio.ack').at(-1)?.data;
      expect(lastAck).toMatchObject({ paused: false, queueMs: 0, queueDepth: 0 });
      expect(sentEvents.some((e) => (e.data as Record<string, unknown>)?.code === 'INGRESS_BACKPRESSURE')).toBe(false);
    } finally {
      release();
    }
  });

  it('uses one batched VAD call per 100 ms packet while retaining all per-frame decisions', async () => {
    vad.detectBatch = jest.fn().mockResolvedValue(Array.from({ length: 5 }, () => ({ speech: false, probability: 0 })));
    await beginSession();
    const packet = frame(0, 1, 3200);
    manager.handleBinary(socket, packet);
    await waitFor(() => sentEvents.some((e) => e.type === 'voice.audio.ack'));
    expect(vad.detect).not.toHaveBeenCalled();
    expect(vad.detectBatch).toHaveBeenCalledTimes(1);
    expect(vad.detectBatch).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({ data: packet.subarray(11) }),
    }));
  });

  it('fails explicitly on queue overflow rather than feeding a truncated speech segment to STT', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vad.detect.mockImplementation(async () => { await pending; return { speech: true, probability: 1 }; });
    await beginSession();
    try {
      for (let i = 0; i < 21; i++) manager.handleBinary(socket, frame(i, 1, 3200));
      expect(sentEvents.some((e) => (e.data as Record<string, unknown>)?.code === 'AUDIO_QUEUE_OVERFLOW')).toBe(true);
      expect(sttTranscribe).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it('stops on global ingress overload instead of continuing with missing speech', async () => {
    await beginSession();
    Reflect.set(manager, 'ingressWindowStart', Date.now());
    Reflect.set(manager, 'ingressWindowBytes', 4_000 * 1024);
    manager.handleBinary(socket, frame(0, 1, 3200));
    expect(sentEvents.some((event) => event.type === 'voice.session.error' &&
      (event.data as Record<string, unknown>).code === 'INGRESS_BACKPRESSURE' &&
      (event.data as Record<string, unknown>).recoverable === false)).toBe(true);
    await waitFor(() => manager.activeSessionCount === 0);
    expect(sttTranscribe).not.toHaveBeenCalled();
    expect(vad.detect).not.toHaveBeenCalled();
  });

  it('waits for queued VAD before finalizing an explicit audio-end marker', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vad.detect.mockImplementation(async () => { await pending; return { speech: true, probability: 1 }; });
    const sessionId = await beginSession();
    const packet = frame(0, 1, 3200);
    packet.fill(7, 11);
    try {
      manager.handleBinary(socket, packet);
      await manager.handleText(socket, JSON.stringify({
        v: 1, type: 'voice.audio.end', ts: new Date().toISOString(), sessionId, data: {},
      }));
      expect(sttTranscribe).not.toHaveBeenCalled();
      release();
      await waitFor(() => sttTranscribe.mock.calls.length > 0);
      expect(sttTranscribe.mock.calls[0][0].audio.data).toEqual(Buffer.alloc(3200, 7));
    } finally {
      release();
    }
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
      await waitFor(() => sttTranscribe.mock.calls.some(([input]) => !input.partial));
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

  it('does not duplicate inference with previews on a non-cancellable batch STT provider', async () => {
    Object.defineProperty(stt, 'supportsPartial', { value: false });
    vad.detect.mockResolvedValue({ speech: true, probability: 0.99 });
    const sessionId = await beginSession();
    for (let index = 0; index < 8; index++) {
      manager.handleBinary(socket, frame(index, 1, 12800));
      await waitFor(() => vad.detect.mock.calls.length >= (index + 1) * 20);
    }
    expect(sttTranscribe).not.toHaveBeenCalled();
    await manager.handleText(socket, JSON.stringify({
      v: 1, type: 'voice.audio.end', ts: new Date().toISOString(), sessionId, data: {},
    }));
    await waitFor(() => sentEvents.some(event => event.type === 'voice.assistant.turn.end'));
    expect(sttTranscribe).toHaveBeenCalledTimes(1);
    expect(sttTranscribe.mock.calls[0][0].partial).toBe(false);
    const speech = sentEvents.find(event => event.type === 'voice.speech.started');
    const final = sentEvents.find(event => event.type === 'voice.transcript.final');
    const response = sentEvents.find(event => event.type === 'voice.assistant.response');
    const end = sentEvents.find(event => event.type === 'voice.assistant.audio.end');
    if (!speech || !final || !response || !end) throw new Error('Expected all correlated voice stages.');
    const turnId = (speech.data as Record<string, unknown>).turnId;
    expect((final.data as Record<string, unknown>).turnId).toBe(turnId);
    expect((final.data as Record<string, unknown>).buffering).toEqual({
      preRollMs: 0, trailingSilenceMs: 0, vadSpeechMs: 3200, reason: 'client_end',
    });
    expect((final.data as Record<string, unknown>).audioDiagnostics).toBeUndefined();
    expect((response.data as Record<string, unknown>).turnId).toBe(turnId);
    expect((end.data as Record<string, unknown>).timing).toEqual(expect.objectContaining({
      sttMs: expect.any(Number), agentMs: expect.any(Number),
      ttsGenerationMs: expect.any(Number), ttsRealTimeFactor: expect.any(Number),
    }));
  });

  it('preserves every preroll, speech and trailing sample through endpointing into final STT', async () => {
    const previous = process.env.MCZEN_AUDIO_DIAGNOSTICS;
    process.env.MCZEN_AUDIO_DIAGNOSTICS = 'metadata';
    try {
      Object.defineProperty(stt, 'supportsPartial', { value: false });
      let decisions = 0;
      vad.detect.mockImplementation(async () => ({
        speech: ++decisions > 5 && decisions <= 10, probability: 0.9,
      }));
      await beginSession();
      const expected: Buffer[] = [];
      for (let index = 0; index < 9; index++) {
        const packet = frame(index, 1, 3200);
        for (let offset = 11; offset < packet.length; offset += 2) {
          packet.writeInt16LE((index * 5 + Math.floor((offset - 11) / 640)) * 100, offset);
        }
        expected.push(packet.subarray(11));
        manager.handleBinary(socket, packet);
        await waitFor(() => vad.detect.mock.calls.length >= (index + 1) * 5);
      }
      await waitFor(() => sentEvents.some(event => event.type === 'voice.transcript.final'));
      expect(sttTranscribe).toHaveBeenCalledTimes(1);
      expect(sttTranscribe.mock.calls[0][0].audio.data.equals(Buffer.concat(expected))).toBe(true);
      expect(sentEvents.find(event => event.type === 'voice.transcript.final')?.data).toEqual(expect.objectContaining({
        audioMs: 900,
        buffering: { preRollMs: 100, trailingSilenceMs: 700, vadSpeechMs: 100, reason: 'silence' },
        audioDiagnostics: expect.objectContaining({
          finalStt: expect.objectContaining({ samples: 14400, audioMs: 900, clippingPercent: 0 }),
          ingress: expect.objectContaining({ packets: 9, missingPackets: 0, reorderedPackets: 0 }),
        }),
      }));
    } finally {
      if (previous === undefined) delete process.env.MCZEN_AUDIO_DIAGNOSTICS;
      else process.env.MCZEN_AUDIO_DIAGNOSTICS = previous;
    }
  });

  it('preserves a low-quality transcript but asks to repeat without invoking shopping or agent tools', async () => {
    sttTranscribe.mockResolvedValue({
      text: 'Open mic heart.', language: 'en', isFinal: true,
      recognitionQuality: { reliable: false, reason: 'low_log_probability', avgLogProbability: -1.2 },
    });
    await beginSession();
    for (let index = 0; index < 40; index++) manager.handleBinary(socket, frame(index));
    await waitFor(() => sentEvents.some(event => event.type === 'voice.assistant.turn.end'));
    expect(sentEvents.find(event => event.type === 'voice.transcript.final')?.data).toEqual(expect.objectContaining({
      text: 'Open mic heart.', recognitionQuality: expect.objectContaining({ reliable: false }),
    }));
    expect(sentEvents.find(event => event.type === 'voice.assistant.response')?.data).toEqual(expect.objectContaining({
      answer: 'I could not hear that clearly. Please repeat your request.',
    }));
    expect(agentInvoke).not.toHaveBeenCalled();
    expect(tts.synthesize).toHaveBeenCalled();
  });
  it('retains raw STT text separately and never renames a product during whitespace normalization', async () => {
    sttTranscribe.mockResolvedValue({ text: '  Explain  ZENAGE.\n', language: 'en', isFinal: true });
    await beginSession();
    for (let index = 0; index < 40; index++) manager.handleBinary(socket, frame(index));
    await waitFor(() => sentEvents.some(event => event.type === 'voice.assistant.turn.end'));
    expect(sentEvents.find(event => event.type === 'voice.transcript.final')?.data).toEqual(expect.objectContaining({
      rawText: '  Explain  ZENAGE.\n', text: 'Explain ZENAGE.',
    }));
    expect(agentInvoke).toHaveBeenCalledWith('Explain ZENAGE.', expect.anything(), expect.any(AbortSignal));
  });

  it('cancels a disconnected session VAD request and ignores its late failure without a recovery error', async () => {
    let activeSignal: AbortSignal | undefined;
    vad.detectBatch = jest.fn().mockImplementation(request => new Promise((_resolve, reject) => {
      activeSignal = request.signal;
      request.signal.addEventListener('abort', () => reject(new VoiceProviderError('VOICE_PROVIDER_TIMEOUT')), { once: true });
    }));
    await beginSession();
    manager.handleBinary(socket, frame(0, 1, 3200));
    await waitFor(() => activeSignal !== undefined);
    manager.onDisconnect(socket);
    expect(activeSignal?.aborted).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(sentEvents.some(event => event.type === 'voice.session.error')).toBe(false);
    expect(sttTranscribe).not.toHaveBeenCalled();
  });

  it.each([false, true])('reports a TTS failure accurately and recovers its own session (after chunk: %s)', async afterChunk => {
    tts.synthesize.mockImplementation(async function* () {
      if (afterChunk) yield { encoding: 'pcm_s16le', sampleRate: 16000, data: Buffer.alloc(640) };
      throw new Error('Provider failed');
    });
    await beginSession();
    for (let index = 0; index < 40; index++) manager.handleBinary(socket, frame(index));
    await waitFor(() => sentEvents.some(event => event.type === 'voice.session.error'));
    const error = sentEvents.find(event => event.type === 'voice.session.error');
    expect(error?.data).toEqual(expect.objectContaining({ code: 'TTS_UNAVAILABLE', recoverable: true }));
    expect(manager.activeSessionCount).toBe(1);
    expect(sentEvents.some(event => event.type === 'voice.assistant.epoch')).toBe(true);
  });

  it('keeps decimal prices and product acronyms intact and bounds every TTS segment', async () => {
    const answer = `HALE.O costs 10.50 Indian rupees. ${'Stored product information '.repeat(30).trim()}`;
    agentInvoke.mockResolvedValue({ success: true, answer, model: 'verified-catalogue', toolCalls: [], sources: [] });
    await beginSession();
    for (let index = 0; index < 40; index++) manager.handleBinary(socket, frame(index));
    await waitFor(() => sentEvents.some((event) => event.type === 'voice.assistant.turn.end'));
    const segments = tts.synthesize.mock.calls.map(([request]) => request.text);
    expect(segments[0]).toBe('HALE.O costs 10.50 Indian rupees.');
    expect(segments.every((segment) => segment.length <= 500)).toBe(true);
    expect(segments.join(' ')).toBe(answer);
  });
  it('starts TTS for a streamed completed sentence before the agent finishes, then sends the final response once', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    agent.stream = jest.fn().mockImplementation(async function* () {
      yield { text: 'ZENAGE product information.' };
      await pending;
      yield { response: { success: true, answer: 'ZENAGE product information.', model: 'gpu',
        toolCalls: [{ name: 'get_product_details', resultCount: 1 }], sources: [] } };
    });
    await beginSession();
    for (let index = 0; index < 40; index++) manager.handleBinary(socket, frame(index));
    await waitFor(() => tts.synthesize.mock.calls.length > 0);
    expect(sentEvents.some(event => event.type === 'voice.assistant.turn.end')).toBe(false);
    finish();
    await waitFor(() => sentEvents.some(event => event.type === 'voice.assistant.turn.end'));
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(sentEvents.filter(event => event.type === 'voice.assistant.response')).toHaveLength(1);
    expect(sentEvents.find(event => event.type === 'voice.assistant.response')?.data).toEqual(
      expect.objectContaining({ answer: 'ZENAGE product information.', model: 'gpu' }));
  });

  it('reports a failed streamed agent answer as an agent error, not a Piper error', async () => {
    agent.stream = jest.fn().mockImplementation(async function* () {
      yield { text: 'Partial product information.' };
      yield { response: { success: false, answer: 'The provider stream failed.', model: 'gpu', toolCalls: [], sources: [] } };
    });
    await beginSession();
    for (let index = 0; index < 40; index++) manager.handleBinary(socket, frame(index));
    await waitFor(() => sentEvents.some(event => event.type === 'voice.session.error'));
    expect(sentEvents.find(event => event.type === 'voice.session.error')?.data).toEqual(
      expect.objectContaining({ code: 'AGENT_UNAVAILABLE' }));
    expect(sentEvents.some(event => event.type === 'voice.assistant.turn.end')).toBe(false);
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
