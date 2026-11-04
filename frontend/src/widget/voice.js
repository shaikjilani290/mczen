import { VoiceClient } from "../voice/voiceClient.js";

// Languages that may use voice come only from the backend's reported capabilities; nothing is assumed here.
export function voiceSupport(voice, language, env = globalThis) {
  if (!voice?.available) return { ok: false, reason: "Voice is not available right now. You can type instead." };
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
export function createWidgetVoice({ client, apiBase, onState, onPartial, onFinal, onResponse, onError, VoiceClientImpl = VoiceClient, clientOptions = {} }) {
  let active = null;
  let starting = false;
  let state = "idle";

  const setState = (next) => {
    state = next;
    onState(next);
  };

  async function start(language) {
    if (active || starting) return;
    starting = true;
    const voice = new VoiceClientImpl({
      webSocketUrl: () => toWebSocketUrl(apiBase),
      ticketProvider: async () => (await client.voiceTicket()).ticket,
      onState: (next) => { if (active === voice || starting) setState(next); },
      onError: (message) => onError(message),
      onEvent: (event) => {
        if (active !== voice) return;
        if (event.type === "voice.transcript.partial") onPartial(event.data.text || "");
        else if (event.type === "voice.transcript.final") { onPartial(""); onFinal(event.data.text || ""); }
        else if (event.type === "voice.assistant.response") onResponse(event.data.answer || "", Array.isArray(event.data.sources) ? event.data.sources : []);
      },
      ...clientOptions,
    });
    active = voice;
    try {
      await voice.start(null, { language });
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
    isActive: () => active !== null,
    state: () => state,
  };
}
