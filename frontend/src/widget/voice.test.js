import test from "node:test";
import assert from "node:assert/strict";
import { createWidgetVoice, toWebSocketUrl, voiceSupport } from "./voice.js";
import { createWidgetClient } from "./client.js";
import { VoiceClient } from "../voice/voiceClient.js";

const env = { navigator: { mediaDevices: { getUserMedia() {} } }, AudioContext: class {}, WebSocket: class {} };
const voiceCaps = { available: true, speechLanguages: ["en", "hi"], textOnlyLanguages: ["te"] };

test("voice diagnostics distinguish missing engines, assistant settings and browser restrictions", () => {
  assert.match(voiceSupport({ available: false, diagnostics: { unavailable: ["stt", "tts"] } }, "en", env).reason, /STT, TTS/);
  assert.match(voiceSupport({ available: false, diagnostics: { reason: "assistant_settings_unavailable" } }, "en", env).reason, /assistant/);
  assert.match(voiceSupport(voiceCaps, "en", { ...env, isSecureContext: false }).reason, /HTTPS/);
  assert.match(voiceSupport(voiceCaps, "en", {
    ...env, document: { permissionsPolicy: { allowsFeature: () => false } },
  }).reason, /Permissions-Policy/);
});

test("voice support follows backend capabilities, with Telugu text-only", () => {
  assert.equal(voiceSupport(voiceCaps, "en", env).ok, true);
  assert.equal(voiceSupport(voiceCaps, "hi", env).ok, true);
  const te = voiceSupport(voiceCaps, "te", env);
  assert.equal(te.ok, false);
  assert.match(te.reason, /text/i);
  assert.equal(voiceSupport({ ...voiceCaps, available: false }, "en", env).ok, false);
  assert.equal(voiceSupport(null, "en", env).ok, false);
  assert.equal(voiceSupport(voiceCaps, "en", { ...env, navigator: {} }).ok, false);
  assert.equal(voiceSupport({ available: true, speechLanguages: ["te"], textOnlyLanguages: [] }, "te", env).ok, true);
});

test("websocket url is derived from the api base without credentials", () => {
  assert.equal(toWebSocketUrl("https://m.test"), "wss://m.test/api/voice/stream");
  assert.equal(toWebSocketUrl("http://localhost:3000"), "ws://localhost:3000/api/voice/stream");
});

test("voiceTicket sends the session token in a header, rotates it and returns the ticket", async () => {
  const calls = [];
  const replies = [
    { sessionToken: "s1", config: {} },
    { ticket: "mzt_abc", sessionToken: "s2", voice: voiceCaps },
    { ticket: "mzt_def", sessionToken: "s3" },
  ];
  const client = createWidgetClient({
    apiBase: "https://m.test",
    publicKey: "wk_x",
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => replies.shift() }; },
  });
  await client.start();
  assert.equal((await client.voiceTicket()).ticket, "mzt_abc");
  await client.voiceTicket();
  assert.equal(calls[1].url, "https://m.test/api/widget/public/voice-ticket");
  assert.ok(calls.every((c) => !c.url.includes("s1") && !c.url.includes("mzt_")));
  assert.equal(calls[2].init.headers.Authorization.endsWith("s2"), true);
});

test("voiceTicket maps 403 and 429 to safe errors", async () => {
  for (const [status, code] of [[403, "unavailable"], [429, "rate"], [401, "expired"]]) {
    const queue = [{ ok: true, status: 200, json: async () => ({ sessionToken: "s1" }) }, { ok: false, status, json: async () => ({}) }];
    const client = createWidgetClient({ apiBase: "https://m.test", publicKey: "wk_x", fetchImpl: async () => queue.shift() });
    await client.start();
    await assert.rejects(client.voiceTicket(), (e) => e.code === code);
  }
});

test("voiceTicket forwards startup cancellation to connect and ticket fetches", async () => {
  const signals = [];
  const client = createWidgetClient({
    apiBase: "https://m.test", publicKey: "wk_x",
    fetchImpl: async (url, init) => {
      signals.push(init.signal);
      return { ok: true, json: async () => url.endsWith("/session")
        ? { sessionToken: "s1", config: {} } : { ticket: "mzt_x" } };
    },
  });
  const controller = new AbortController();
  await client.voiceTicket({ signal: controller.signal });
  assert.deepEqual(signals, [controller.signal, controller.signal]);
});

class FakeVoiceClient {
  static instances = [];
  constructor(options) { this.options = options; this.stopped = 0; this.interrupted = 0; FakeVoiceClient.instances.push(this); }
  async start(token, opts) { this.started = { token, opts }; if (FakeVoiceClient.failWith) throw FakeVoiceClient.failWith; this.options.onState("listening"); }
  async stop() { this.stopped += 1; }
  interrupt() { this.interrupted += 1; }
}

function harness() {
  FakeVoiceClient.instances = [];
  FakeVoiceClient.failWith = null;
  const log = { states: [], partials: [], finals: [], responses: [], deltas: [], errors: [], cartActivity: [] };
  const voice = createWidgetVoice({
    client: { voiceTicket: async () => ({ ticket: "mzt_x" }), setVoiceActive: active => log.cartActivity.push(active) },
    apiBase: "https://m.test",
    VoiceClientImpl: FakeVoiceClient,
    onState: (s) => log.states.push(s),
    onPartial: (t) => log.partials.push(t),
    onFinal: (t) => log.finals.push(t),
    onResponse: (a, s, p) => log.responses.push([a, s, p]),
    onDelta: text => log.deltas.push(text),
    onError: (m) => log.errors.push(m),
  });
  return { voice, log };
}

test("delivers streamed text only for active-session streamed events, without duplicating ordinary responses", async () => {
  const { voice, log } = harness();
  await voice.start("en");
  const active = FakeVoiceClient.instances.at(-1);
  active.options.onEvent({ type: "voice.assistant.text.delta", data: { delta: "Ordinary sentence." } });
  active.options.onEvent({ type: "voice.assistant.text.delta", data: { delta: "ZENAGE details.", streamed: true } });
  assert.deepEqual(log.deltas, ["ZENAGE details."]);
  await voice.stop();
  active.options.onEvent({ type: "voice.assistant.text.delta", data: { delta: "Stale sentence.", streamed: true } });
  assert.deepEqual(log.deltas, ["ZENAGE details."]);
});

test("audio metadata requires local opt-in and survives cart navigation only for that widget lifetime", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true, value: { hostname: "127.0.0.1", search: "?mczenAudioDiagnostics=metadata" },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "location", original);
    else delete globalThis.location;
  });
  const { voice } = harness();
  await voice.start("en");
  assert.equal(FakeVoiceClient.instances.at(-1).options.audioDiagnostics, true);
  await voice.stop();
  globalThis.location.search = "";
  await voice.start("en");
  assert.equal(FakeVoiceClient.instances.at(-1).options.audioDiagnostics, true);
  await voice.stop();
  const fresh = harness();
  await fresh.voice.start("en");
  assert.equal(FakeVoiceClient.instances.at(-1).options.audioDiagnostics, false);
  await fresh.voice.stop();
  globalThis.location.hostname = "merchant.example";
  globalThis.location.search = "?mczenAudioDiagnostics=metadata";
  const remote = harness();
  await remote.voice.start("en");
  assert.equal(FakeVoiceClient.instances.at(-1).options.audioDiagnostics, false);
  await remote.voice.stop();
  assert.equal(new VoiceClient({ audioDiagnostics: true }).audioDiagnostics, false);
});

test("only one voice session may be active; concurrent starts are ignored", async () => {
  const { voice } = harness();
  await Promise.all([voice.start("en"), voice.start("en")]);
  await voice.start("en");
  assert.equal(FakeVoiceClient.instances.length, 1);
  assert.equal(voice.isActive(), true);
  assert.deepEqual(FakeVoiceClient.instances[0].started, { token: null, opts: { language: "en" } });
});

test("cart delivery follows voice lifecycle, including reconnect, errors and stop", async () => {
  const { voice, log } = harness();
  await voice.start("en");
  const instance = FakeVoiceClient.instances[0];
  instance.options.onState("reconnecting");
  instance.options.onState("error");
  await voice.stop();
  assert.deepEqual(log.cartActivity, [true, true, false, false]);
  instance.options.onState("listening");
  assert.equal(log.cartActivity.at(-1), false, "stale stopped sessions cannot reactivate cart polling");
});

test("passes the selected voice through the existing voice session without changing language or tickets", async () => {
  const { voice } = harness();
  await voice.start("en", "en_GB-alba-medium");
  assert.deepEqual(FakeVoiceClient.instances[0].started, {
    token: null, opts: { language: "en", voiceId: "en_GB-alba-medium" },
  });
  assert.deepEqual(await FakeVoiceClient.instances[0].options.ticketProvider({}), "mzt_x");
  await voice.stop();
});

test("transcripts and responses are forwarded; events after stop are ignored", async () => {
  const { voice, log } = harness();
  await voice.start("hi");
  const { onEvent } = FakeVoiceClient.instances[0].options;
  onEvent({ type: "voice.transcript.partial", data: { text: "nam" } });
  onEvent({ type: "voice.transcript.final", data: { text: "namaste" } });
  onEvent({ type: "voice.assistant.response", data: { answer: "hello", sources: [{ title: "a" }] } });
  assert.deepEqual(log.finals, ["namaste"]);
  assert.deepEqual(log.responses, [["hello", [{ title: "a" }], []]]);
  await voice.stop();
  onEvent({ type: "voice.assistant.response", data: { answer: "stale" } });
  assert.equal(log.responses.length, 1);
  assert.equal(FakeVoiceClient.instances[0].stopped, 1);
  assert.equal(voice.isActive(), false);
  assert.equal(log.states.at(-1), "idle");
});

test("voice assistant responses forward structured product cards", async () => {
  const { voice, log } = harness();
  await voice.start("en");
  const product = { name: "Tea", productUrl: "https://shop.example/tea", images: ["https://shop.example/tea.jpg"] };
  FakeVoiceClient.instances[0].options.onEvent({
    type: "voice.assistant.response",
    data: { answer: "Tea is available.", sources: [], products: [product] },
  });
  assert.deepEqual(log.responses, [["Tea is available.", [], [product]]]);
  await voice.stop();
});

test("voice forwards the complete verified cart response for navigation and rejects stale events", async () => {
  const received = [];
  const voice = createWidgetVoice({
    client: { voiceTicket: async () => ({ ticket: "mzt_x" }), setVoiceActive() {} },
    apiBase: "https://m.test", VoiceClientImpl: FakeVoiceClient,
    onState: () => {}, onPartial: () => {}, onFinal: () => {}, onError: message => assert.fail(message),
    onResponse: (answer, sources, products, response) => received.push(response),
  });
  await voice.start("en");
  const active = FakeVoiceClient.instances.at(-1);
  const data = {
    success: true, answer: "ZENAGE has been added to your cart.",
    cartOperation: { operation: "add_to_cart", cartVerified: true },
    navigationAction: { id: "a".repeat(64), type: "OPEN_CHECKOUT", url: "https://shop.example/checkout" },
  };
  active.options.onEvent({ type: "voice.assistant.response", data });
  assert.equal(received[0], data);
  await voice.stop();
  active.options.onEvent({ type: "voice.assistant.response", data });
  assert.equal(received.length, 1);
});

test("interrupt reaches the active client; stop releases it for a fresh start", async () => {
  const { voice } = harness();
  await voice.start("en");
  voice.interrupt();
  assert.equal(FakeVoiceClient.instances[0].interrupted, 1);
  await voice.stop();
  await voice.start("en");
  assert.equal(FakeVoiceClient.instances.length, 2);
});

test("a failed start cleans up, reports an error and allows retry", async () => {
  const { voice, log } = harness();
  FakeVoiceClient.failWith = new Error("Microphone permission is required.");
  await voice.start("en");
  assert.equal(voice.isActive(), false);
  assert.equal(FakeVoiceClient.instances[0].stopped, 1);
  assert.match(log.errors[0], /Microphone/);
  FakeVoiceClient.failWith = null;
  await voice.start("en");
  assert.equal(voice.isActive(), true);
});

test("VoiceClient uses an injected ticket provider and never a bearer fetch", async () => {
  let fetched = 0;
  const sockets = [];
  class Socket {
    constructor(url, protocol) { this.url = url; this.protocol = protocol; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(d) { this.sent.push(d); }
    close() { this.readyState = 3; }
  }
  const client = new VoiceClient({
    fetchFn: async () => { fetched += 1; return { ok: false, status: 500, json: async () => ({}) }; },
    WebSocketImpl: Socket,
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    audioContextFactory: () => ({}),
    ticketProvider: async () => "mzt_widget",
    webSocketUrl: () => "wss://m.test/api/voice/stream",
  });
  const started = client.start(null, { language: "en" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  const socket = sockets[0];
  assert.equal(socket.url, "wss://m.test/api/voice/stream");
  assert.ok(!socket.url.includes("mzt_"));
  socket.readyState = 1;
  socket.onopen();
  const hello = JSON.parse(socket.sent[0]);
  assert.equal(hello.type, "voice.session.start");
  assert.equal(hello.data.ticket, "mzt_widget");
  assert.equal("assistantId" in hello.data, false);
  assert.equal(fetched, 0);
  socket.onclose({ code: 4401 });
  await started;
  await client.stop();
});
