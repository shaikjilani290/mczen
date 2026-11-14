import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  Globe,
  Keyboard,
  Languages,
  LogOut,
  Mic,
  MicOff,
  PanelLeft,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { voiceApi } from "./voice/voiceApi.js";
import { VoiceClient } from "./voice/voiceClient.js";
import { createMerchantNavigation } from "./widget/merchant-navigation.js";
import { getVoiceOptions, hasSpeechOutput, LANGUAGE_LABELS, mapTranscript } from "./voice/voiceCapabilities.js";

const QUICK_PROMPTS = [
  "What is McZEN?",
  "Tips for better sleep",
  "Nutrition advice for energy",
];

const STATUS_LABELS = {
  idle: "Tap to speak",
  connecting: "Connecting…",
  listening: "I'm listening",
  transcribing: "Transcribing…",
  processing: "Thinking…",
  speaking: "Speaking",
  interrupted: "Interrupted",
  reconnecting: "Reconnecting…",
  error: "Voice unavailable",
};

function formatStamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const label = date.toDateString() === today.toDateString()
    ? "Today"
    : date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
  return `${label} · ${time}`;
}

function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [login, setLogin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function activate(loginToken, tenant) {
    setBusy(true);
    setError("");
    try {
      const active = await voiceApi.activateTenant(loginToken, tenant.id);
      setPassword("");
      onSignedIn(active.accessToken, tenant);
    } catch (issue) {
      setError(issue.message || "Unable to open this workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await voiceApi.login(email.trim(), password);
      setPassword("");
      const tenants = Array.isArray(result.tenants) ? result.tenants : [];
      if (!tenants.length) throw new Error("This account has no available workspace.");
      if (tenants.length === 1) {
        await activate(result.accessToken, tenants[0]);
      } else {
        setLogin({ token: result.accessToken, tenants });
      }
    } catch (issue) {
      setError(issue.message || "Sign-in failed. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app app-auth">
      <span className="app-glow" aria-hidden="true" />
      <section className="auth-shell">
        <div className="auth-brand">
          <span className="brand-mark">M</span>
          <span><b>McZEN</b><small>VOICE COMPANION</small></span>
        </div>
        <h1>Talk to your knowledge</h1>
        <p className="auth-copy">Ask by voice or text and hear grounded answers in your own language.</p>

        {error && <div className="banner error" role="alert">{error}</div>}

        {!login ? (
          <form onSubmit={submit} className="auth-form">
            <label>
              Email address
              <input
                autoComplete="username"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="auth-submit" disabled={busy}>
              {busy ? "Signing in…" : "Continue"}
            </button>
          </form>
        ) : (
          <div className="tenant-list">
            <p className="sheet-label">Choose your workspace</p>
            {login.tenants.map((tenant) => (
              <button key={tenant.id} disabled={busy} onClick={() => activate(login.token, tenant)}>
                <span>{tenant.name}</span>
                <small>{tenant.role}</small>
              </button>
            ))}
          </div>
        )}

        <ul className="auth-features">
          <li><Globe size={14} /> English, Hindi and Telugu — spoken replies</li>
          <li><ShieldCheck size={14} /> Private workspace, isolated per tenant</li>
        </ul>
        <p className="auth-foot">
          <Sparkles size={13} /> Microphone access starts only when you begin a session.
        </p>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [assistants, setAssistants] = useState([]);
  const [assistantId, setAssistantId] = useState("");
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState([]);
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem("mczen.voice.language") || "auto";
    } catch {
      return "auto";
    }
  });
  const [selectedVoice, setSelectedVoice] = useState("");
  const [voiceSettings, setVoiceSettings] = useState(null);
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [partial, setPartial] = useState("");
  const [clientState, setClientState] = useState("idle");
  const [connected, setConnected] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheet, setSheet] = useState(null);
  const clientRef = useRef(null);
  const [merchantNavigation, setMerchantNavigation] = useState(null);
  const navigationRef = useRef(null);
  if (!navigationRef.current) {
    navigationRef.current = createMerchantNavigation({
      merchantOrigin: import.meta.env.VITE_MERCHANT_ORIGIN || undefined,
      onFallback: setMerchantNavigation,
      onError: message => setError(message),
    });
  }
  const transcriptEnd = useRef(null);
  const composerRef = useRef(null);
  const interruptedTimerRef = useRef(null);
  const workspaceRef = useRef({ session: null, conversationId: "", language: "auto", detectedLanguage: "" });
  const skipHistoryForRef = useRef("");
  workspaceRef.current = { session, conversationId, language, detectedLanguage };

  const handleVoiceEvent = useCallback((event) => {
    if (event.type === "voice.session.started") {
      const settings = event.data.settings || {};
      setVoiceSettings(settings);
      setDetectedLanguage(event.data.language === "auto" ? "" : event.data.language);
      setConnected(true);
      setNotice("");
    } else if (event.type === "voice.session.resumed") {
      setConnected(true);
    } else if (event.type === "voice.transcript.partial") {
      setPartial(event.data.text || "");
      if (event.data.language) setDetectedLanguage(event.data.language);
    } else if (event.type === "voice.transcript.final") {
      setPartial("");
      if (event.data.language) setDetectedLanguage(event.data.language);
      setMessages((items) => [...items, {
        role: "user",
        content: event.data.text || "",
        language: event.data.language || null,
        createdAt: event.ts,
      }]);
    } else if (event.type === "voice.assistant.response") {
      navigationRef.current.handle(event.data);
      setMessages((items) => [...items, {
        role: "assistant",
        content: event.data.answer || "",
        language: workspaceRef.current.detectedLanguage || workspaceRef.current.language,
        sources: Array.isArray(event.data.sources) ? event.data.sources : [],
        createdAt: event.ts,
      }]);
    } else if (event.type === "voice.assistant.interrupt") {
      if (interruptedTimerRef.current) clearTimeout(interruptedTimerRef.current);
      interruptedTimerRef.current = setTimeout(() => setClientState("listening"), 350);
    } else if (event.type === "voice.assistant.turn.end") {
      const { session: activeSession } = workspaceRef.current;
      if (activeSession?.token) {
        void voiceApi.conversations(activeSession.token).then((result) => {
          setConversations(Array.isArray(result.items) ? result.items : []);
        }).catch(() => setNotice("Your reply was saved, but the conversation list could not be refreshed."));
      }
    } else if (event.type === "voice.session.close") {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    const client = new VoiceClient({
      onEvent: handleVoiceEvent,
      onState: (state) => {
        setClientState(state);
        if (state === "reconnecting" || state === "idle" || state === "error") setConnected(false);
        if (state !== "interrupted" && interruptedTimerRef.current) {
          clearTimeout(interruptedTimerRef.current);
          interruptedTimerRef.current = null;
        }
      },
      onError: (message) => setError(message),
    });
    clientRef.current = client;
    return () => {
      if (interruptedTimerRef.current) clearTimeout(interruptedTimerRef.current);
      clientRef.current = null;
      void client.stop();
    };
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, partial, busy]);

  const refreshConversations = useCallback(async (token) => {
    const result = await voiceApi.conversations(token);
    setConversations(Array.isArray(result.items) ? result.items : []);
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    let active = true;
    setLoadingWorkspace(true);
    setError("");
    Promise.all([
      voiceApi.assistants(session.token),
      voiceApi.conversations(session.token),
    ]).then(([assistantResult, conversationResult]) => {
      if (!active) return;
      const list = Array.isArray(assistantResult.assistants) ? assistantResult.assistants : [];
      const items = Array.isArray(conversationResult.items) ? conversationResult.items : [];
      const currentConversationId = items[0]?.id || "";
      const currentConversation = items.find((item) => item.id === currentConversationId);
      setAssistants(list);
      setAssistantId((current) => list.some((item) => item.id === current)
        ? current
        : (list.find((item) => item.id === currentConversation?.assistantId)?.id || list[0]?.id || ""));
      setConversations(items);
      setConversationId(currentConversationId);
    }).catch((issue) => {
      if (!active) return;
      setError(issue.message || "Unable to load your workspace.");
      if (issue.status === 401) setSession(null);
    }).finally(() => {
      if (active) setLoadingWorkspace(false);
    });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!session || !conversationId) {
      setMessages([]);
      return undefined;
    }
    if (skipHistoryForRef.current === conversationId) {
      skipHistoryForRef.current = "";
      return undefined;
    }
    let active = true;
    setBusy(true);
    voiceApi.transcript(session.token, conversationId).then((result) => {
      if (active) setMessages(mapTranscript(result));
    }).catch((issue) => {
      if (active) setError(issue.message || "Conversation history could not be loaded.");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [session, conversationId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && clientRef.current && connected) {
        void clientRef.current.stop();
        setConnected(false);
        setNotice("Voice session paused because this tab is in the background.");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [connected]);

  const selectedAssistant = assistants.find((item) => item.id === assistantId);
  const voiceOptions = useMemo(() => getVoiceOptions(language, voiceSettings), [language, voiceSettings]);
  const allowedLanguages = voiceSettings?.allowedLanguages;
  const canSpeakLanguage = hasSpeechOutput(language, voiceSettings);
  const voiceActive = ["connecting", "listening", "transcribing", "processing", "speaking", "interrupted", "reconnecting"].includes(clientState);
  const hasThread = messages.length > 0 || Boolean(partial);

  async function createConversation() {
    if (!session || !assistantId) throw new Error("Choose an assistant before starting a conversation.");
    const id = await voiceApi.createConversation(session.token, assistantId, language);
    const createdId = typeof id === "string" ? id : id.id;
    if (!createdId) throw new Error("The conversation could not be created.");
    await refreshConversations(session.token);
    skipHistoryForRef.current = createdId;
    setConversationId(createdId);
    setMessages([]);
    setSheet(null);
    return createdId;
  }

  // Telugu always speaks with the `my_voice` voice; other languages keep the
  // assistant default unless the user picked a voice explicitly.
  function resolveVoiceId() {
    if (language === "te" && voiceOptions.some((item) => item.id === "my_voice")) return "my_voice";
    return voiceOptions.some((item) => item.id === selectedVoice) ? selectedVoice : "";
  }

  async function startVoice() {
    if (!session || !assistantId || voiceActive) return;
    setError("");
    setNotice("");
    setPartial("");
    setBusy(true);
    try {
      let activeConversation = conversationId;
      if (!activeConversation) activeConversation = await createConversation();
      const voiceId = resolveVoiceId();
      await clientRef.current.start(session.token, {
        assistantId,
        conversationId: activeConversation,
        language,
        ...(voiceId ? { voiceId } : {}),
      });
    } catch (issue) {
      setConnected(false);
      setError(issue.message || "Unable to start a voice session.");
    } finally {
      setBusy(false);
    }
  }

  async function stopVoice() {
    await clientRef.current?.stop();
    setConnected(false);
    setPartial("");
  }

  async function switchConversation(id) {
    if (voiceActive) await stopVoice();
    const conversation = conversations.find((item) => item.id === id);
    if (conversation?.assistantId && assistants.some((item) => item.id === conversation.assistantId)) {
      setAssistantId(conversation.assistantId);
      setVoiceSettings(null);
      setSelectedVoice("");
    }
    setConversationId(id);
    setError("");
    setNotice("");
    setSheet(null);
  }

  async function submitText(event) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy || !session) return;
    setInput("");
    setError("");
    if (voiceActive) await stopVoice();
    setBusy(true);
    try {
      let activeConversation = conversationId;
      if (!activeConversation) activeConversation = await createConversation();
      setMessages((items) => [...items, { role: "user", content: question, createdAt: new Date().toISOString() }]);
      const result = await voiceApi.ask(session.token, question, activeConversation);
      if (typeof result.answer !== "string") throw new Error("McZEN returned an invalid response.");
      navigationRef.current.handle(result);
      setMessages((items) => [...items, {
        role: "assistant",
        content: result.answer,
        sources: Array.isArray(result.sources) ? result.sources : [],
        createdAt: new Date().toISOString(),
      }]);
      await refreshConversations(session.token);
    } catch (issue) {
      setError(issue.message || "Your message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (clientRef.current) await clientRef.current.stop();
    try {
      if (session?.token) await voiceApi.signOut(session.token);
    } catch {
      // Local sign-out must still complete if the network is unavailable.
    }
    setSheet(null);
    setConnected(false);
    setSession(null);
    setAssistants([]);
    setConversations([]);
    setMerchantNavigation(null);
    setConversationId("");
    setMessages([]);
  }

  function changeLanguage(value) {
    setLanguage(value);
    setSelectedVoice("");
    setDetectedLanguage("");
    try { localStorage.setItem("mczen.voice.language", value); } catch { /* preference is optional */ }
    if (connected) {
      setNotice("Language changes apply to the next voice session.");
    }
  }

  if (!session) {
    return <SignIn onSignedIn={(token, tenant) => setSession({ token, tenant })} />;
  }

  const statusLabel = STATUS_LABELS[clientState] || STATUS_LABELS.idle;
  const stageHint = clientState === "transcribing"
    ? "Finishing recognition — keep this tab open"
    : clientState === "error"
      ? "Retry, or continue by typing"
      : detectedLanguage
        ? `Detected ${LANGUAGE_LABELS[detectedLanguage] || detectedLanguage}`
        : connected
          ? "Speak naturally — pause when you're done"
          : "English, Hindi or Telugu";

  return (
    <main className="app">
      <span className={`app-glow ${voiceActive ? "is-live" : ""}`} aria-hidden="true" />

      <div className="app-frame">
        <header className="top-bar">
          <button className="round-btn" onClick={() => setSheet("history")} aria-label="Conversations" title="Conversations">
            <PanelLeft size={17} />
          </button>
          <span className="brand-pill">
            <span className={`brand-dot ${connected ? "is-live" : ""}`} />
            {selectedAssistant?.name || "McZEN"}
            <em>Beta</em>
          </span>
          <button className="round-btn" onClick={() => setSheet("settings")} aria-label="Settings" title="Settings">
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          </button>
        </header>

        <section className={`stage state-${clientState} ${hasThread ? "is-compact" : ""}`}>
          <div className={`orb ${voiceActive ? "is-live" : ""}`}>
            <span className="orb-aura" aria-hidden="true" />
            <span className="orb-shell" aria-hidden="true">
              <span className="orb-ribbon r1" />
              <span className="orb-ribbon r2" />
              <span className="orb-ribbon r3" />
              <span className="orb-gloss" />
            </span>
          </div>

          <p className="stage-status" aria-live="polite">{statusLabel}</p>
          <p className="stage-hint">{stageHint}</p>

          <div className="voice-controls">
            <button
              className="round-btn control"
              onClick={() => {
                if (clientState === "speaking") clientRef.current?.interrupt();
                else if (connected) void stopVoice();
                else if (partial) setPartial("");
              }}
              aria-label={clientState === "speaking" ? "Interrupt reply" : "Stop voice"}
              title={clientState === "speaking" ? "Interrupt reply" : "Stop voice"}
            >
              {voiceActive ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>

            <button
              className={`mic-btn ${voiceActive ? "is-active" : ""}`}
              onClick={() => (voiceActive ? void stopVoice() : void startVoice())}
              disabled={busy || loadingWorkspace || !assistantId}
              aria-label={voiceActive ? "Stop voice session" : "Start voice session"}
              title={voiceActive ? "Stop voice session" : "Start voice session"}
            >
              {voiceActive ? <MicOff size={22} /> : <Mic size={22} />}
            </button>

            <button
              className="round-btn control"
              onClick={() => composerRef.current?.focus()}
              aria-label="Type a message"
              title="Type a message"
            >
              <Keyboard size={17} />
            </button>
          </div>
        </section>

        <section className="thread" aria-live="polite">
          {!hasThread && !busy && (
            <div className="quick-row">
              {QUICK_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" onClick={() => { setInput(prompt); composerRef.current?.focus(); }}>
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {language === "te" && !canSpeakLanguage && (
            <div className="banner info" role="status">
              తెలుగు గుర్తింపు అందుబాటులో ఉంది. తెలుగు వాక్యీకరణ ఇప్పటికీ సందేశ అవుట్‌పుట్‌గా అందించబడదు; జవాబులు బదులుగా వచనంగా చూపబడతాయి.
            </div>
          )}
          {language === "auto" && voiceSettings && !canSpeakLanguage && (
            <div className="banner info" role="status">
              మీ అసిస్టెంట్ కోసం సెట్ చేసిన డిఫాల్ట్ భాషకు వాక్యీకరణ అందుబాటులో లేదు. వాక్యీకరణ లేని భాషలకు జవాబులు బదులుగా వచనంగా అందుతాయి.
            </div>
          )}

          {messages.map((message, index) => (
            <article className={`bubble ${message.role}`} key={`${message.createdAt || "message"}-${index}`}>
              {message.role === "assistant" ? (
                <>
                  <header className="bubble-head">
                    <span className="bubble-avatar"><Bot size={14} /></span>
                    <b>{selectedAssistant?.name || "McZEN"}</b>
                    <span className="bubble-time">{formatStamp(message.createdAt)}</span>
                  </header>
                  <p>{message.content}</p>
                  {message.sources?.length > 0 && (
                    <div className="source-list">
                      {message.sources.map((source, sourceIndex) => (
                        <span className="source-chip" key={`${source.id || source.title || "source"}-${sourceIndex}`}>
                          {source.title || source.source || "Source"}
                        </span>
                      ))}
                    </div>
                  )}
                  <footer className="bubble-foot">
                    {message.language && <span className="chip">{LANGUAGE_LABELS[message.language] || message.language}</span>}
                    <span className="bubble-foot-note">Grounded answer</span>
                    <span className="bubble-action" aria-hidden="true"><Sparkles size={13} /></span>
                  </footer>
                </>
              ) : (
                <>
                  <p>{message.content}</p>
                  {message.language && <span className="bubble-time">{formatStamp(message.createdAt)}</span>}
                </>
              )}
            </article>
          ))}

          {partial && (
            <div className="bubble user is-partial">
              <p><span className="live-dot" />{partial}</p>
            </div>
          )}
          {busy && (
            <div className="thinking"><span /><span /><span /></div>
          )}
          <div ref={transcriptEnd} />
        </section>

        {(error || notice) && (
          <div className={`banner ${error ? "error" : "info"} inline`} role={error ? "alert" : "status"}>
            <span>{error || notice}</span>
            <button onClick={() => (error ? setError("") : setNotice(""))} aria-label="Dismiss">×</button>
          </div>
        )}

        <div className="dock">
          {merchantNavigation && (
            <a href={merchantNavigation.url} target="_blank" rel="noopener noreferrer">
              {merchantNavigation.label}
            </a>
          )}
          <form className="composer" onSubmit={submitText}>
            <input
              ref={composerRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask anything"
              aria-label="Message"
              maxLength={2000}
            />
            <button className="send-btn" disabled={!input.trim() || busy || !selectedAssistant} aria-label="Send message">
              <Send size={17} />
            </button>
          </form>
          <p className="dock-foot">
            {connected ? <><Wifi size={12} /> Secure session</> : <><WifiOff size={12} /> Voice is off</>}
            {voiceSettings?.ttsEngineId && <span>· {voiceSettings.ttsEngineId}</span>}
          </p>
        </div>
      </div>

      {sheet && (
        <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={sheet === "history" ? "Conversations" : "Settings"}>
          <button className="sheet-backdrop" onClick={() => setSheet(null)} aria-label="Close" />
          <div className={`sheet sheet-${sheet}`}>
            {sheet === "history" ? (
              <>
                <header className="sheet-head">
                  <div><p className="sheet-label">Your space</p><h2>Conversations</h2></div>
                  <button
                    className="round-btn accent"
                    onClick={async () => {
                      if (!assistantId) return;
                      try {
                        if (voiceActive) await stopVoice();
                        await createConversation();
                      } catch (issue) { setError(issue.message); }
                    }}
                    aria-label="New conversation"
                    title="New conversation"
                    disabled={!assistantId}
                  >
                    <Plus size={17} />
                  </button>
                </header>
                <div className="conv-list">
                  {conversations.map((item) => (
                    <button
                      key={item.id}
                      className={`conv-item ${conversationId === item.id ? "selected" : ""}`}
                      onClick={() => void switchConversation(item.id)}
                    >
                      <span className="conv-dot" />
                      <span className="conv-copy">
                        <b>{item.title || "New conversation"}</b>
                        <small>{item.messageCount || 0} messages</small>
                      </span>
                    </button>
                  ))}
                  {!conversations.length && <p className="conv-empty">Your conversations will appear here.</p>}
                </div>
                <footer className="sheet-foot">
                  <span className="avatar">{session.tenant?.name?.slice(0, 1) || "M"}</span>
                  <span><b>{session.tenant?.name || "Signed in"}</b><small>Private workspace</small></span>
                </footer>
              </>
            ) : (
              <>
                <header className="sheet-head">
                  <div><p className="sheet-label">Session</p><h2>Settings</h2></div>
                  <button className="round-btn" onClick={() => setSheet(null)} aria-label="Close settings">
                    <X size={17} />
                  </button>
                </header>

                <div className="sheet-body">
                  <label className="field">
                    <span><Languages size={15} /> Language</span>
                    <select value={language} onChange={(event) => changeLanguage(event.target.value)} disabled={voiceActive}>
                      {Object.entries(LANGUAGE_LABELS).map(([code, label]) => {
                        const unavailable = code !== "auto" && Array.isArray(allowedLanguages) && !allowedLanguages.includes(code);
                        return <option key={code} value={code} disabled={unavailable}>{label}{unavailable ? " · unavailable" : ""}</option>;
                      })}
                    </select>
                  </label>

                  <label className="field">
                    <span><Volume2 size={15} /> Voice</span>
                    <select
                      value={selectedVoice}
                      onChange={(event) => setSelectedVoice(event.target.value)}
                      disabled={voiceActive || voiceOptions.length === 0}
                    >
                      {voiceOptions.length
                        ? <option value="">Assistant default</option>
                        : <option value="">Text only</option>}
                      {voiceOptions.map((option) => (
                        <option value={option.id} key={option.id}>{option.label} · {option.gender}</option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span><Bot size={15} /> Assistant</span>
                    <select
                      value={assistantId}
                      onChange={(event) => {
                        setAssistantId(event.target.value);
                        setConversationId("");
                        setMessages([]);
                        setVoiceSettings(null);
                        setSelectedVoice("");
                        setSheet(null);
                      }}
                      disabled={voiceActive}
                    >
                      {assistants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>

                  <div className="field static">
                    <span><Wifi size={15} /> Session</span>
                    <p>{connected ? <><Check size={13} /> Connected</> : "Not connected"}</p>
                  </div>

                  <button className="sign-out" onClick={signOut}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
