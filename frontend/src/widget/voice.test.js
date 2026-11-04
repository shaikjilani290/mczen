import test from "node:test";
import assert from "node:assert/strict";
import { createWidgetVoice, toWebSocketUrl, voiceSupport } from "./voice.js";
import { createWidgetClient } from "./client.js";
import { VoiceClient } from "../voice/voiceClient.js";

const env = { navigator: { mediaDevices: { getUserMedia() {} } }, AudioContext: class {}, WebSocket: class {} };
const voiceCaps = { available: true, speechLanguages: ["en", "hi"], textOnlyLanguages: ["te"] };

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
  const log = { states: [], partials: [], finals: [], responses: [], errors: [] };
  const voice = createWidgetVoice({
    client: { voiceTicket: async () => ({ ticket: "mzt_x" }) },
    apiBase: "https://m.test",
    VoiceClientImpl: FakeVoiceClient,
    onState: (s) => log.states.push(s),
    onPartial: (t) => log.partials.push(t),
    onFinal: (t) => log.finals.push(t),
    onResponse: (a, s) => log.responses.push([a, s]),
    onError: (m) => log.errors.push(m),
  });
  return { voice, log };
}

test("only one voice session may be active; concurrent starts are ignored", async () => {
  const { voice } = harness();
  await Promise.all([voice.start("en"), voice.start("en")]);
  await voice.start("en");
  assert.equal(FakeVoiceClient.instances.length, 1);
  assert.equal(voice.isActive(), true);
  assert.deepEqual(FakeVoiceClient.instances[0].started, { token: null, opts: { language: "en" } });
});

test("transcripts and responses are forwarded; events after stop are ignored", async () => {
  const { voice, log } = harness();
  await voice.start("hi");
  const { onEvent } = FakeVoiceClient.instances[0].options;
  onEvent({ type: "voice.transcript.partial", data: { text: "nam" } });
  onEvent({ type: "voice.transcript.final", data: { text: "namaste" } });
  onEvent({ type: "voice.assistant.response", data: { answer: "hello", sources: [{ title: "a" }] } });
  assert.deepEqual(log.finals, ["namaste"]);
  assert.deepEqual(log.responses, [["hello", [{ title: "a" }]]]);
  await voice.stop();
  onEvent({ type: "voice.assistant.response", data: { answer: "stale" } });
  assert.equal(log.responses.length, 1);
  assert.equal(FakeVoiceClient.instances[0].stopped, 1);
  assert.equal(voice.isActive(), false);
  assert.equal(log.states.at(-1), "idle");
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
