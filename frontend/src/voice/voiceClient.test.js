import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { captureWorkletSource } from "./capture-worklet.js";
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
      const source = { connect() {}, start(when) { this.startedAt = when; }, stop() { this.stopped = true; }, onended: null };
      createdSources.push(source);
      return source;
    },
  };
}
for (const sampleRate of [16000, 44100, 48000]) {
  test(`reports fallback resampling only for a non-16000Hz AudioContext: ${sampleRate}`, async t => {
    const diagnostics = [];
    const warnings = [];
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    const context = fakeAudioContext();
    context.sampleRate = sampleRate;
    const client = new VoiceClient({
      audioContextFactory: () => context,
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
      onDiagnostic: event => diagnostics.push(event),
    });
    client.shouldReconnect = true;
    try {
      await client.startAudioCapture();
      const resampling = diagnostics.filter(event => event.stage === "audio_resampler");
      assert.equal(warnings.length, sampleRate === 16000 ? 0 : 1);
      assert.equal(resampling.length, sampleRate === 16000 ? 0 : 1);
      if (sampleRate !== 16000) {
        assert.equal(resampling[0].sourceSampleRate, sampleRate);
        assert.equal(resampling[0].wireSampleRate, 16000);
        assert.equal(resampling[0].fallbackResampler, true);
        assert.match(resampling[0].message, /fallback resampler is in use/);
      }
    } finally {
      await client.stop();
    }
  });
}

for (const rejection of ["SESSION_MISMATCH", "UNAUTHORIZED"]) {
  test(`reconnect handles ${rejection} without bypassing authentication or looping terminal failures`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let tickets = 0;
    const errors = [];
    const client = new VoiceClient({
      ticketProvider: async () => `ticket-${++tickets}`,
      WebSocketImpl: FakeWebSocket,
      webSocketUrl: () => "ws://localhost/api/voice/stream",
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
      audioContextFactory: fakeAudioContext,
      onError: error => errors.push(error),
    });
    const acknowledge = socket => socket.onmessage({ data: JSON.stringify({
      v: 1, type: "voice.session.started", sessionId: "voice-session", epoch: 1, data: {},
    }) });
    try {
      const starting = client.start(null, { language: "en", conversationId: "conversation" });
      await new Promise(setImmediate);
      acknowledge(FakeWebSocket.latest);
      await starting;
      client.resumeToken = "previous-resume";
      FakeWebSocket.latest.close(1006);
      t.mock.timers.tick(750);
      await new Promise(setImmediate);
      const resumed = FakeWebSocket.latest;
      assert.equal(JSON.parse(resumed.sent[0]).data.resumeToken, "previous-resume");
      resumed.onmessage({ data: JSON.stringify({
        v: 1, type: "voice.session.error", data: {
          code: rejection, message: "Session rejected.", recoverable: false,
        },
      }) });
      resumed.close(rejection === "SESSION_MISMATCH" ? 4404 : 4401);
      await new Promise(setImmediate);
      t.mock.timers.tick(1500);
      await new Promise(setImmediate);
      if (rejection === "SESSION_MISMATCH") {
        const replacement = FakeWebSocket.latest;
        assert.notEqual(replacement, resumed);
        const data = JSON.parse(replacement.sent[0]).data;
        assert.equal(data.ticket, "ticket-3");
        assert.equal(data.resumeToken, undefined);
        assert.equal(data.conversationId, "conversation");
        assert.equal(data.language, "en");
        acknowledge(replacement);
        await new Promise(setImmediate);
        assert.equal(client.shouldReconnect, true);
        assert.deepEqual(errors, []);
      } else {
        t.mock.timers.tick(60000);
        await new Promise(setImmediate);
        assert.equal(tickets, 2);
        assert.equal(client.shouldReconnect, false);
        assert.deepEqual(errors, ["Session rejected."]);
      }
    } finally {
      await client.stop();
      t.mock.timers.reset();
    }
  });
}

test("expired widget authentication during reconnect stops retries and reports the original error", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const errors = [];
  const client = new VoiceClient({
    ticketProvider: async () => {
      calls++;
      throw Object.assign(new Error("The conversation expired. Please try again."), { code: "expired" });
    },
    onError: error => errors.push(error),
  });
  client.shouldReconnect = true;
  try {
    client.scheduleReconnect();
    t.mock.timers.tick(750);
    await new Promise(setImmediate);
    t.mock.timers.tick(60000);
    await new Promise(setImmediate);
    assert.equal(calls, 1);
    assert.equal(client.shouldReconnect, false);
    assert.deepEqual(errors, ["The conversation expired. Please try again."]);
  } finally { await client.stop(); t.mock.timers.reset(); }
});

for (const scenario of ["delayed permission", "microphone timeout", "connection timeout", "websocket timeout", "ticket timeout", "authentication failure", "cancelled ticket"]) {
  test(`separates server connection from ${scenario}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let releaseMicrophone;
    let stopped = false;
    const stream = { getTracks: () => [{ stop() { stopped = true; } }] };
    const permission = new Promise((resolve) => { releaseMicrophone = resolve; });
    const states = [];
    const diagnostics = [];
    let ticketSignal;
    const client = new VoiceClient({
      ticketProvider: async ({ signal }) => {
        ticketSignal = signal;
        if (scenario === "ticket timeout" || scenario === "cancelled ticket") return new Promise(() => {});
        return "one-use-ticket";
      },
      WebSocketImpl: scenario === "websocket timeout" ? class {
        constructor() { this.readyState = 0; FakeWebSocket.latest = this; }
        close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
      } : FakeWebSocket,
      webSocketUrl: () => "ws://localhost/api/voice/stream",
      mediaDevices: { getUserMedia: () => permission },
      audioContextFactory: fakeAudioContext,
      onState: (state) => states.push(state),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    let outcome;
    const starting = client.start(null, { language: "en" }).then(
      () => { outcome = "ready"; },
      (error) => { outcome = error.message; },
    );
    try {
      await new Promise(setImmediate);
      if (scenario === "ticket timeout" || scenario === "cancelled ticket") {
        if (scenario === "ticket timeout") t.mock.timers.tick(12_001);
        else await client.stop();
        await starting;
        assert.match(outcome, scenario === "ticket timeout" ? /^Voice session creation timed out/ : /cancelled/);
        assert.equal(ticketSignal.aborted, true);
        assert.equal(diagnostics.some((d) => d.stage === "websocket_connecting"), false);
        return;
      }
      const socket = FakeWebSocket.latest;
      if (scenario === "authentication failure") {
        socket.onmessage({ data: JSON.stringify({
          v: 1, type: "voice.session.error", data: {
            code: "UNAUTHORIZED", message: "Voice authentication failed.", recoverable: false,
          },
        }) });
        await starting;
        assert.equal(outcome, "Voice authentication failed.");
        assert.equal(states.includes("requesting_microphone"), false);
        assert.equal(diagnostics.some((d) => d.stage === "server_rejected_session"), true);
        return;
      }
      if (scenario !== "connection timeout" && scenario !== "websocket timeout") {
        socket.onmessage({ data: JSON.stringify({
          v: 1, type: "voice.session.started", sessionId: "session-id", epoch: 1, data: {},
        }) });
        assert.equal(states.at(-1), "requesting_microphone");
      }
      t.mock.timers.tick(12_001);
      await new Promise(setImmediate);
      if (scenario === "connection timeout" || scenario === "websocket timeout") {
        await starting;
        assert.match(outcome, scenario === "connection timeout" ? /server did not acknowledge/ : /WebSocket could not open/);
        assert.equal(states.includes("requesting_microphone"), false);
      } else {
        assert.equal(outcome, undefined, "server handshake deadline must not expire during microphone startup");
        if (scenario === "microphone timeout") {
          t.mock.timers.tick(48_000);
          await starting;
          assert.match(outcome, /^Microphone startup timed out/);
          assert.equal(socket.readyState, 3);
        }
        assert.equal(JSON.stringify(diagnostics).includes("one-use-ticket"), false);
        releaseMicrophone(stream);
        await new Promise(setImmediate);
        await starting;
        if (scenario === "delayed permission") {
          assert.equal(outcome, "ready");
          assert.equal(states.at(-1), "listening");
        } else {
          assert.equal(stopped, true, "late permission grant must release the microphone");
          assert.equal(client.audioContext, null);
        }
      }
    } finally {
      releaseMicrophone(stream);
      await client.stop();
      t.mock.timers.reset();
    }
  });
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

test("preserves microphone denial before cleanup closes the socket", async () => {
  const client = new VoiceClient({
    ticketProvider: async () => "ticket",
    WebSocketImpl: FakeWebSocket,
    webSocketUrl: () => "ws://localhost/api/voice/stream",
    mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } },
    audioContextFactory: fakeAudioContext,
  });
  const starting = client.start(null, { language: "en" });
  const rejected = assert.rejects(starting, /Microphone access was denied/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  FakeWebSocket.latest.onmessage({ data: JSON.stringify({
    v: 1, type: "voice.session.started", sessionId: "session-id", epoch: 1, data: {},
  }) });
  await rejected;
  assert.equal(client.shouldReconnect, false);
  assert.equal(client.stream, null);
});

test("flow control bounds in-flight audio, preserves order through congestion and clears stale epochs", async (t) => {
  const errors = [];
  const client = new VoiceClient({
    ticketProvider: async () => "ticket",
    WebSocketImpl: FakeWebSocket,
    webSocketUrl: () => "ws://localhost/api/voice/stream",
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    audioContextFactory: fakeAudioContext,
    onError: (message) => errors.push(message),
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const starting = client.start(null, { language: "en" });
  await new Promise(setImmediate);
  const socket = FakeWebSocket.latest;
  let now = 0;
  t.mock.method(performance, "now", () => now);
  try {
    socket.onmessage({ data: JSON.stringify({
      v: 1, type: "voice.session.started", epoch: 1, sessionId: "session", data: { flowControl: "ack-v1" },
    }) });
    await starting;
    const frames = () => socket.sent.filter((value) => value instanceof ArrayBuffer);
    client.pendingSamples = Float32Array.from({ length: 16000 }, (_, i) => i / 32000);
    for (let i = 0; i < 10; i++) {
      now += 100;
      client.flushCapture();
    }
    assert.equal(frames().length, 5, "backend credits cap unprocessed audio at 500 ms");
    assert.equal(client.pendingSamples.length, 8000, "unsent speech is retained");
    socket.bufferedAmount = 6401;
    await client.handleMessage(JSON.stringify({ v: 1, type: "voice.audio.ack", epoch: 1,
      data: { sequence: 0, paused: false, queueMs: 200 } }));
    assert.equal(frames().length, 5, "congested WebSocket pauses sending");
    assert.equal(client.sequence, 5, "unsent audio does not consume sequence numbers");
    socket.bufferedAmount = 0;
    now += 100;
    client.flushCapture();
    assert.equal(frames().length, 6);
    assert.equal(new DataView(frames()[5]).getInt16(11, true), Math.round(8000 / 32000 * 32767));
    await client.handleMessage(JSON.stringify({ v: 1, type: "voice.audio.flow", data: { paused: true } }));
    now += 100;
    client.flushCapture();
    assert.equal(frames().length, 6);
    await client.handleMessage(JSON.stringify({
      v: 1, type: "voice.assistant.epoch", epoch: 2, data: { reason: "turn_reset" },
    }));
    assert.equal(client.pendingSamples.length, 0);
    client.flushCapture();
    assert.equal(frames().length, 6, "prior-turn audio is not sent in the new epoch");
    assert.equal(client.inFlight.size, 0);
    assert.deepEqual(errors, [], "backpressure does not discard or warn while bounded");
    await client.stop();
    t.mock.timers.tick(500);
    assert.equal(frames().length, 6, "stop cancels the audio sender");
  } finally {
    await client.stop();
    t.mock.timers.reset();
  }
});

test("capture overflow stops the session explicitly rather than silently dropping speech", async () => {
  const errors = [];
  const client = new VoiceClient({ onError: (message) => errors.push(message) });
  client.shouldReconnect = true;
  client.pendingSamples = new Float32Array(32000);
  client.captureOverflow();
  await new Promise(setImmediate);
  assert.match(errors[0], /2-second buffer.*stopped.*incomplete speech/);
  assert.equal(client.shouldReconnect, false);
  assert.equal(client.pendingSamples.length, 0);
});

test("delayed polling cannot throttle backlog recovery below real time", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new VoiceClient();
  const packets = [];
  client.shouldReconnect = true;
  client.socket = { readyState: 1, bufferedAmount: 0, send: (packet) => packets.push(packet) };
  client.pendingSamples = new Float32Array(16000);
  try {
    client.flushCapture();
    assert.equal(packets.length, 1);
    for (let i = 1; i < 10; i++) {
      now += 50;
      t.mock.timers.tick(50);
    }
    assert.equal(packets.length, 10, "one second of delayed audio drains in 450 ms, not a drifting second");
    assert.equal(client.pendingSamples.length, 0);
    assert.deepEqual(packets.map((p) => new DataView(p).getUint32(5)), Array.from({ length: 10 }, (_, i) => i));
  } finally {
    t.mock.timers.reset();
  }
});

test("coalesces delayed worklet packets without exceeding backend byte credits", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const packets = [];
  const client = new VoiceClient();
  client.shouldReconnect = true;
  client.flowControl = true;
  client.socket = { readyState: 1, bufferedAmount: 0, send: (packet) => packets.push(packet) };
  try {
    for (let i = 0; i < 3; i++) {
      client.pendingFrames.push(
        { pcm: new Int16Array(1600).fill(i * 2), capturedAt: now },
        { pcm: new Int16Array(1600).fill(i * 2 + 1), capturedAt: now + 100 },
      );
      now += 100;
      client.flushCapture();
    }
    assert.deepEqual(packets.map((p) => p.byteLength - 11), [6400, 6400, 3200]);
    assert.equal([...client.inFlight.values()].reduce((sum, f) => sum + f.bytes, 0), 16000);
    assert.equal(client.pendingFrames.length, 1, "last frame waits rather than exceeding 500 ms in flight");
    const first = new DataView(packets[0]);
    assert.equal(first.getInt16(11, true), 0);
    assert.equal(first.getInt16(11 + 3200, true), 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("AudioWorklet preserves sample order and resampling phase, bounds its credit queue and reports overflow", () => {
  function worklet(rate, diagnostics = false) {
    let Processor;
    const messages = [];
    runInNewContext(captureWorkletSource, {
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (data) => messages.push(data) }; } },
      sampleRate: rate, currentTime: 0,
      registerProcessor: (_name, value) => { Processor = value; },
    });
    const processor = new Processor({ processorOptions: { audioDiagnostics: diagnostics } });
    processor.port.onmessage({ data: { type: "reset", epoch: 1 } });
    return { processor, messages };
  }
  const { processor, messages } = worklet(48000);
  for (let i = 0; i < 375; i++) {
    processor.process([[new Float32Array(128).fill(i < 188 ? 0.25 : -0.25)]]);
    processor.port.onmessage({ data: { type: "credit", epoch: 1 } });
  }
  const audio = messages.filter((m) => m.type === "audio");
  assert.equal(audio.reduce((n, m) => n + m.pcm.length, 0), 16000, "48,000 input samples produce exactly 16,000 samples");
  assert.equal(audio[0].pcm[0], 8192);
  assert.equal(audio.at(-1).pcm.at(-1), -8192);
  assert.ok(audio.every((m) => m.pcm.length === 1600 && m.epoch === 1));
  const slow = worklet(16000);
  for (let i = 0; i < 300; i++) slow.processor.process([[new Float32Array(128)]]);
  assert.equal(slow.messages.filter((m) => m.type === "audio").length, 2, "only two uncredited MessagePort packets are allowed");
  assert.equal(slow.messages.filter((m) => m.type === "overflow").length, 1);
  assert.equal(slow.processor.count, 32000);
  assert.equal(messages.some(m => m.type === "diagnostics"), false, "raw capture has no metadata overhead by default");
  for (const rate of [16000, 44100, 48000]) {
    const measured = worklet(rate, true);
    for (let offset = 0; offset < rate; offset += 128) {
      measured.processor.process([[new Float32Array(Math.min(128, rate - offset)).fill(0.25)]]);
      measured.processor.port.onmessage({ data: { type: "credit", epoch: 1 } });
    }
    const levels = measured.messages.find(m => m.type === "diagnostics");
    assert.equal(levels.source.samples, rate);
    assert.equal(levels.resampled.samples, 16000);
    assert.equal(levels.source.rms, 0.25);
    assert.equal(levels.resampled.rms, 0.25);
    assert.equal(levels.resampled.clippingPercent, 0);
    assert.equal(levels.resampled.silencePercent, 0);
    const samples = measured.messages.filter(m => m.type === "audio").flatMap(m => Array.from(m.pcm));
    assert.equal(samples.length, 16000);
    assert.ok(samples.every(value => value === 8192), "no missing, duplicated or distorted constant samples");
  }
});

test("does not reconnect after a terminal rate-limit rejection", async () => {
  const client = new VoiceClient({
    ticketProvider: async () => "ticket", WebSocketImpl: FakeWebSocket,
    webSocketUrl: () => "ws://localhost/api/voice/stream",
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    audioContextFactory: fakeAudioContext,
  });
  const starting = client.start(null, { language: "en" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = FakeWebSocket.latest;
  socket.onmessage({ data: JSON.stringify({
    v: 1, type: "voice.session.started", sessionId: "session", epoch: 1, data: {},
  }) });
  await starting;
  socket.onmessage({ data: JSON.stringify({
    v: 1, type: "voice.session.error", data: { code: "RATE_LIMITED", message: "Audio frame rate is too high.", recoverable: false },
  }) });
  socket.close(4429);
  assert.equal(client.shouldReconnect, false);
  assert.equal(client.reconnectTimer, null);
  assert.equal(client.captureTimer, null);
  await client.stop();
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

test("lets scheduled speech finish on normal turn reset while rejecting stale packets and stopping on recovery", async () => {
  const client = new VoiceClient();
  const audio = fakeAudioContext();
  client.audioContext = audio;
  client.epoch = 1;
  client.queuePlayback({ epoch: 1, pcm: new Int16Array(16000) });
  const source = audio.createdSources[0];
  const scheduledEnd = client.nextAudioTime;
  await client.handleMessage(JSON.stringify({
    v: 1, type: "voice.assistant.epoch", epoch: 2, data: { reason: "turn_reset" },
  }));
  assert.equal(client.epoch, 2);
  assert.notEqual(source.stopped, true);
  assert.equal(client.nextAudioTime, scheduledEnd);
  assert.equal(client.playing.size, 1);
  client.queuePlayback({ epoch: 1, pcm: new Int16Array(16000) });
  assert.equal(audio.createdSources.length, 1, "old-epoch packets are not played after the reset");
  source.onended();
  assert.equal(client.playing.size, 0);
  client.queuePlayback({ epoch: 2, pcm: new Int16Array(16000) });
  const next = audio.createdSources[1];
  await client.handleMessage(JSON.stringify({
    v: 1, type: "voice.assistant.epoch", epoch: 3, data: { reason: "recovered" },
  }));
  assert.equal(next.stopped, true);
  assert.equal(client.playing.size, 0);
  await client.stop();
});

test("real VAD speech stops buffered output even after server generation has reset its epoch", async () => {
  const client = new VoiceClient();
  const audio = fakeAudioContext();
  client.audioContext = audio;
  client.epoch = 1;
  client.queuePlayback({ epoch: 1, pcm: new Int16Array(16000) });
  const source = audio.createdSources[0];
  await client.handleMessage(JSON.stringify({
    v: 1, type: "voice.assistant.epoch", epoch: 2, data: { reason: "turn_reset" },
  }));
  await client.handleMessage(JSON.stringify({
    v: 1, type: "voice.speech.started", epoch: 2, data: { sequence: 0, offsetMs: 0, turnId: "next-turn" },
  }));
  assert.equal(source.stopped, true);
  assert.equal(client.epoch, 2, "stopping local output must not reset the new utterance");
  assert.equal(client.metrics.turnId, "next-turn");
  await client.stop();
});

test("restarts the playback clock when reconnect creates a fresh AudioContext", async () => {
  const replacement = fakeAudioContext();
  const client = new VoiceClient({
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    audioContextFactory: () => replacement,
  });
  client.audioContext = fakeAudioContext();
  client.audioContext.currentTime = 45;
  client.clearPlayback();
  await client.releaseAudio();
  client.shouldReconnect = true;
  await client.startAudioCapture();
  client.queuePlayback({ epoch: client.epoch, pcm: new Int16Array(16000) });
  assert.equal(replacement.createdSources[0].startedAt, 0.02);
  assert.equal(client.nextAudioTime, 1.02);
  await client.stop();
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
