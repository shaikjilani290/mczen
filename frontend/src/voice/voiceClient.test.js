import test from "node:test";
import assert from "node:assert/strict";
import {
  VoiceClient,
  VOICE_PROTOCOL,
  decodeAudioFrame,
  encodeAudioFrame,
  floatToPcm16,
  resampleTo16k,
} from "./voiceClient.js";
import {
  getVoiceOptions,
  hasSpeechOutput,
  mapTranscript,
} from "./voiceCapabilities.js";

test("resamples mono audio and converts float samples into signed PCM16", () => {
  const resampled = resampleTo16k(new Float32Array([0, 1, 0, -1, 0, 1]), 48000);
  assert.equal(resampled.length, 2);
  assert.deepEqual([...floatToPcm16(new Float32Array([-1, 0, 1]))], [-32768, 0, 32767]);
});

test("uses backend language/voice capabilities and keeps unsupported Telugu output text-only", () => {
  const capabilities = {
    defaultLanguage: "hi",
    allowedLanguages: ["en", "hi", "te"],
    ttsLanguages: ["en", "hi"],
    voices: {
      en: [{ id: "amy", gender: "female" }],
      hi: [{ id: "pratham", gender: "male" }],
      te: [],
    },
  };
  assert.equal(getVoiceOptions("auto", capabilities)[0].id, "pratham");
  assert.equal(hasSpeechOutput("hi", capabilities), true);
  assert.equal(hasSpeechOutput("te", capabilities), false);
  assert.deepEqual(getVoiceOptions("te", capabilities), []);
});

test("maps persisted conversation history without losing order or sources", () => {
  const history = mapTranscript([
    { role: "user", content: "Hi", language: "en", createdAt: "2026-01-01" },
    { role: "assistant", content: "Hello", sources: [{ id: "s1", title: "Guide" }] },
  ]);
  assert.deepEqual(history.map((message) => message.role), ["user", "assistant"]);
  assert.equal(history[1].sources[0].title, "Guide");
  assert.deepEqual(mapTranscript(null), []);
});

test("encodes and decodes the versioned 11-byte audio frame", () => {
  const encoded = encodeAudioFrame({
    type: 2,
    epoch: 7,
    sequence: 12,
    pcm: new Int16Array([100, -100]),
  });
  const decoded = decodeAudioFrame(new ArrayBuffer(encoded.byteLength));
  assert.equal(decoded, null);
  const copy = encoded.slice(0);
  const result = decodeAudioFrame(copy);
  assert.equal(result.epoch, 7);
  assert.equal(result.sequence, 12);
  assert.deepEqual([...result.pcm], [100, -100]);
  assert.throws(() => encodeAudioFrame({ epoch: 1, sequence: 0, pcm: new Int16Array(8000) }));
});

class FakeWebSocket {
  static latest;
  constructor(url, protocol) {
    this.url = url;
    this.protocol = protocol;
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.sent = [];
    FakeWebSocket.latest = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }
  send(value) { this.sent.push(value); }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function fakeAudioContext() {
  const createdSources = [];
  return {
    sampleRate: 48000,
    currentTime: 0,
    state: "running",
    destination: {},
    createdSources,
    resume: async () => {},
    close: async function close() { this.state = "closed"; },
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBuffer: (_channels, length) => ({
      duration: length / 16000,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const source = { connect() {}, start() {}, stop() { this.stopped = true; }, onended: null };
      createdSources.push(source);
      return source;
    },
  };
}

test("uses a one-use ticket in the initial message and cleans up audio on stop", async () => {
  let audio;
  let trackStopped = false;
  const client = new VoiceClient({
    fetchFn: async (url, options) => {
      assert.equal(url, "/api/voice/ticket");
      assert.match(options.headers.Authorization, /^Bearer /);
      return { ok: true, json: async () => ({ ticket: "mzt_one-use-ticket" }) };
    },
    WebSocketImpl: FakeWebSocket,
    webSocketUrl: () => "wss://mczen.example/api/voice/stream",
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop() { trackStopped = true; } }] }),
    },
    audioContextFactory: () => {
      audio = fakeAudioContext();
      return audio;
    },
  });

  const starting = client.start("jwt-never-in-url", {
    assistantId: "assistant-id",
    conversationId: "conversation-id",
    language: "en",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeWebSocket.latest;
  const start = JSON.parse(socket.sent[0]);
  assert.equal(socket.url.includes("jwt-never-in-url"), false);
  assert.equal(socket.protocol, VOICE_PROTOCOL);
  assert.equal(start.data.ticket, "mzt_one-use-ticket");
  assert.equal(start.data.audioFormat, "pcm_s16le/16000/mono");
  socket.onmessage({
    data: JSON.stringify({
      v: 1,
      type: "voice.session.started",
      ts: new Date().toISOString(),
      sessionId: "session-id",
      epoch: 1,
      data: { settings: {} },
    }),
  });
  await starting;
  await client.stop();
  assert.equal(trackStopped, true);
  assert.equal(audio.state, "closed");
});

test("does not open a socket when ticket authentication fails", async () => {
  let openedSocket = false;
  const client = new VoiceClient({
    fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    WebSocketImpl: class {
      constructor() { openedSocket = true; }
    },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    audioContextFactory: fakeAudioContext,
  });
  await assert.rejects(
    client.start("expired-access-token", { assistantId: "assistant", language: "en" }),
    /sign-in has expired/i,
  );
  assert.equal(openedSocket, false);
});

test("reports transcription separately from assistant thinking and returns to listening after recovery", async () => {
  const states = [];
  const client = new VoiceClient({ onState: (state) => states.push(state) });
  const event = (type, data) => JSON.stringify({ v: 1, type, data });
  await client.handleMessage(event("voice.assistant.thinking", { hint: "transcribing" }));
  await client.handleMessage(event("voice.assistant.thinking", {}));
  await client.handleMessage(event("voice.assistant.epoch", { reason: "recovered", epoch: 2 }));
  await client.handleMessage(event("voice.assistant.thinking", { hint: "transcribing" }));
  await client.handleMessage(event("voice.assistant.epoch", { reason: "turn_reset", epoch: 3 }));
  assert.deepEqual(states, ["transcribing", "processing", "listening", "transcribing", "listening"]);
});

test("preserves unavailable-engine errors instead of replacing them with a generic socket close", async () => {
  let microphoneRequested = false;
  const errors = [];
  const client = new VoiceClient({
    fetchFn: async () => ({ ok: true, json: async () => ({ ticket: "ticket" }) }),
    WebSocketImpl: FakeWebSocket,
    webSocketUrl: () => "ws://localhost/api/voice/stream",
    mediaDevices: { getUserMedia: async () => { microphoneRequested = true; return { getTracks: () => [] }; } },
    audioContextFactory: fakeAudioContext,
    onError: (message) => errors.push(message),
  });
  const starting = client.start("access", { assistantId: "assistant", language: "en" });
  const rejected = assert.rejects(starting, /Local voice services are unavailable.*STT, VAD and TTS/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeWebSocket.latest;
  socket.onmessage({ data: JSON.stringify({
    v: 1, type: "voice.session.error",
    data: { code: "VOICE_ENGINE_UNAVAILABLE", message: "A required voice engine is unavailable.", recoverable: true },
  }) });
  socket.close(4503);
  await rejected;
  assert.match(errors[0], /Local voice services are unavailable/);
  assert.equal(microphoneRequested, false);
  assert.equal(client.shouldReconnect, false);
});

test("stops queued audio immediately on interruption", async () => {
  let audio;
  const client = new VoiceClient({
    fetchFn: async () => ({ ok: true, json: async () => ({ ticket: "ticket" }) }),
    WebSocketImpl: FakeWebSocket,
    webSocketUrl: () => "ws://localhost/api/voice/stream",
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    audioContextFactory: () => (audio = fakeAudioContext()),
  });
  const starting = client.start("access", { assistantId: "assistant", language: "en" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeWebSocket.latest;
  socket.onmessage({
    data: JSON.stringify({
      v: 1,
      type: "voice.session.started",
      ts: new Date().toISOString(),
      sessionId: "session-id",
      epoch: 1,
      data: { settings: {} },
    }),
  });
  await starting;
  socket.onmessage({
    data: encodeAudioFrame({ type: 2, epoch: 1, sequence: 0, pcm: new Int16Array([1, 2]) }),
  });
  const source = audio.createdSources[0];
  assert.ok(source);
  client.interrupt();
  assert.equal(source.stopped, true);
  assert.equal(JSON.parse(socket.sent.at(-1)).type, "voice.assistant.interrupt");
  await client.stop();
});
