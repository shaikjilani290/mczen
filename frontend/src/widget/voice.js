import { VoiceClient } from "../voice/voiceClient.js";

// Languages that may use voice come only from the backend's reported capabilities; nothing is assumed here.
export function voiceSupport(voice, language, env = globalThis) {
  if (!voice?.available) {
    const missing = (voice?.diagnostics?.unavailable || []).filter((name) => ["stt", "vad", "tts"].includes(name));
    const reason = missing.length
      ? `Voice services unavailable: ${missing.map((name) => name.toUpperCase()).join(", ")}. Start them and reload this page. You can type instead.`
      : voice?.diagnostics?.reason === "assistant_settings_unavailable"
      ? "Voice is disabled or misconfigured for this assistant. Ask its admin to check voice settings. You can type instead."
      : voice?.diagnostics?.reason === "no_speech_language"
      ? "No enabled language has a supported voice. You can type instead."
      : "Voice is not available right now. You can type instead.";
    return { ok: false, reason };
  }
  if (env.isSecureContext === false) {
    return { ok: false, reason: "Microphone access requires HTTPS or localhost. You can type instead." };
  }
  const policy = env.document?.permissionsPolicy || env.document?.featurePolicy;
  if (policy?.allowsFeature && !policy.allowsFeature("microphone")) {
    return { ok: false, reason: "This page blocks microphone access through Permissions-Policy. You can type instead." };
  }
  if (!env.navigator?.mediaDevices?.getUserMedia || !(env.AudioContext || env.webkitAudioContext) || !env.WebSocket) {
    return { ok: false, reason: "This browser does not support voice. You can type instead." };
  }
  if (!Array.isArray(voice.speechLanguages) || !voice.speechLanguages.includes(language)) {
    return {
      ok: false,
      reason: (voice.textOnlyLanguages || []).includes(language)
        ? "Voice replies are not available in this language yet. Replies appear as text."
        : "Voice is not available in this language. You can type instead.",
    };
  }
  return { ok: true, reason: "" };
}

export function toWebSocketUrl(apiBase) {
  const url = new URL("/api/voice/stream", apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

// One voice session at a time; start() while active or starting is ignored.
export function createWidgetVoice({ client, apiBase, onState, onPartial, onFinal, onResponse, onDelta = () => {}, onError, VoiceClientImpl = VoiceClient, clientOptions = {} }) {
  const audioDiagnostics = ["localhost", "127.0.0.1", "[::1]"].includes(globalThis.location?.hostname) &&
    new URLSearchParams(globalThis.location?.search).get("mczenAudioDiagnostics") === "metadata";
  let active = null;
  let starting = false;
  let state = "idle";

  const setState = (next) => {
    state = next;
    client.setVoiceActive?.(next !== "idle" && next !== "error");
    onState(next);
  };

  async function start(language, voiceId) {
    if (active?.disposed) active = null;
    if (active || starting) return;
    starting = true;
    const voice = new VoiceClientImpl({
      audioDiagnostics,
      webSocketUrl: () => toWebSocketUrl(apiBase),
      ticketProvider: async ({ signal }) => (await client.voiceTicket({ signal })).ticket,
      onDiagnostic: (diagnostic) => {
        console.debug("[McZEN:voice]", diagnostic);
        if (typeof globalThis.CustomEvent === "function" && globalThis.dispatchEvent) {
          globalThis.dispatchEvent(new CustomEvent("mczen:voice-connection", { detail: diagnostic }));
        }
      },
      onState: (next) => { if (active === voice || starting) setState(next); },
      onError: (message) => onError(message),
      onMetrics: (metrics) => {
        if (typeof globalThis.CustomEvent === "function" && globalThis.dispatchEvent) {
          globalThis.dispatchEvent(new CustomEvent("mczen:voice-metrics", { detail: metrics }));
        }
      },
      onEvent: (event) => {
        if (active !== voice) return;
        if (event.type === "voice.transcript.partial") onPartial(event.data.text || "");
        else if (event.type === "voice.transcript.final") { onPartial(""); onFinal(event.data.text || ""); }
        else if (event.type === "voice.assistant.text.delta" && event.data.streamed === true) onDelta(event.data.delta || "");
        else if (event.type === "voice.assistant.response") onResponse(
          event.data.answer || "",
          Array.isArray(event.data.sources) ? event.data.sources : [],
          Array.isArray(event.data.products) ? event.data.products.slice(0, 5) : [],
          event.data,
        );
      },
      ...clientOptions,
    });
    active = voice;
    try {
      await voice.start(null, { language, ...(voiceId ? { voiceId } : {}) });
    } catch (error) {
      if (active === voice) active = null;
      await voice.stop().catch(() => {});
      setState("idle");
      onError(error?.code === "expired" || error?.code === "unavailable" || error?.code === "rate" || error?.code === "network"
        ? error.message
        : error?.message || "Voice could not be started. You can type instead.");
    } finally {
      starting = false;
    }
  }

  async function stop() {
    const voice = active;
    active = null;
    if (voice) await voice.stop().catch(() => {});
    onPartial("");
    setState("idle");
  }

  return {
    start,
    stop,
    interrupt: () => active?.interrupt(),
    isActive: () => active !== null && !active.disposed,
    state: () => state,
  };
}
