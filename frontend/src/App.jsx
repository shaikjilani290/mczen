import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Bot,
  Languages,
  LogOut,
  Mic,
  MicOff,
  Plus,
  Send,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { voiceApi } from "./voice/voiceApi.js";
import { VoiceClient } from "./voice/voiceClient.js";
import { getVoiceOptions, hasSpeechOutput, LANGUAGE_LABELS, mapTranscript } from "./voice/voiceCapabilities.js";

const STATUS_LABELS = {
  idle: "Ready when you are",
  connecting: "Connecting securely…",
  listening: "Listening",
  transcribing: "Transcribing your speech…",
  processing: "Thinking",
  speaking: "Speaking",
  interrupted: "Interrupted",
  reconnecting: "Reconnecting…",
  error: "Voice unavailable",
};

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
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">M</div>
        <p className="eyebrow">YOUR AI COMPANION</p>
        <h1>Welcome to McZEN</h1>
        <p className="auth-copy">Sign in to continue to your private voice workspace.</p>
        {error && <div className="notice error-notice" role="alert">{error}</div>}
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
            <button className="primary-button full-button" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <div className="tenant-options">
            <p>Choose your workspace</p>
            {login.tenants.map((tenant) => (
              <button
                key={tenant.id}
                disabled={busy}
                onClick={() => activate(login.token, tenant)}
              >
                <span>{tenant.name}</span>
                <small>{tenant.role}</small>
              </button>
            ))}
          </div>
        )}
        <p className="auth-footnote">Your microphone is only used after you choose to start a voice session.</p>
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
  const clientRef = useRef(null);
  const transcriptEnd = useRef(null);
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

  async function createConversation() {
    if (!session || !assistantId) throw new Error("Choose an assistant before starting a conversation.");
    const id = await voiceApi.createConversation(session.token, assistantId, language);
    const createdId = typeof id === "string" ? id : id.id;
    if (!createdId) throw new Error("The conversation could not be created.");
    await refreshConversations(session.token);
    skipHistoryForRef.current = createdId;
    setConversationId(createdId);
    setMessages([]);
    return createdId;
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
      const requestedVoice = voiceOptions.find((item) => item.id === selectedVoice)?.id;
      await clientRef.current.start(session.token, {
        assistantId,
        conversationId: activeConversation,
        language,
        ...(requestedVoice ? { voiceId: requestedVoice } : {}),
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
    setConnected(false);
    setSession(null);
    setAssistants([]);
    setConversations([]);
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

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="#/" aria-label="McZEN voice assistant home">
          <span className="brand-mark">M</span>
          <span><b>McZEN</b><small>VOICE COMPANION</small></span>
        </a>
        <div className="header-right">
          <span className="workspace-name">{session.tenant?.name || "Workspace"}</span>
          <span className={`connection-pill ${connected ? "is-connected" : ""}`}>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connected ? "Connected" : "Offline"}
          </span>
          <button className="icon-button" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="history-panel">
          <div className="history-heading">
            <div><p className="eyebrow">YOUR SPACE</p><h2>Conversations</h2></div>
            <button
              className="icon-button new-chat"
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
              <Plus size={18} />
            </button>
          </div>
          <div className="conversation-list">
            {conversations.map((item) => (
              <button
                key={item.id}
                className={`conversation-item ${conversationId === item.id ? "selected" : ""}`}
                onClick={() => void switchConversation(item.id)}
              >
                <span className="conversation-dot" />
                <span className="conversation-copy">
                  <b>{item.title || "New conversation"}</b>
                  <small>{item.messageCount || 0} messages</small>
                </span>
              </button>
            ))}
            {!conversations.length && <p className="empty-history">Your conversations will appear here.</p>}
          </div>
          <div className="history-foot">
            <span className="user-avatar">{session.tenant?.name?.slice(0, 1) || "M"}</span>
            <span><b>{session.tenant?.name || "Signed in"}</b><small>Private workspace</small></span>
          </div>
        </aside>

        <section className="assistant-panel">
          <div className="assistant-topline">
            <div>
              <p className="eyebrow">PERSONAL AI ASSISTANT</p>
              <h1>How can I help?</h1>
            </div>
            <label className="assistant-select">
              <span>Assistant</span>
              <select
                value={assistantId}
                onChange={(event) => {
                  setAssistantId(event.target.value);
                  setConversationId("");
                  setMessages([]);
                  setVoiceSettings(null);
                  setSelectedVoice("");
                }}
                disabled={voiceActive}
              >
                {assistants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>

          <div className={`voice-stage state-${clientState}`}>
            <div className={`voice-orb ${voiceActive ? "orb-active" : ""}`}>
              <span className="orb-ring ring-one" />
              <span className="orb-ring ring-two" />
              <span className="orb-core"><AudioLines size={30} strokeWidth={1.7} /></span>
            </div>
            <div className="voice-caption" aria-live="polite">
              <strong>{STATUS_LABELS[clientState] || STATUS_LABELS.idle}</strong>
              <span>
                {clientState === "transcribing"
                  ? "Please wait for recognition to finish. Keep this tab open."
                  : clientState === "error"
                  ? "You can retry or continue with text."
                  : detectedLanguage
                    ? `Detected ${LANGUAGE_LABELS[detectedLanguage] || detectedLanguage}`
                    : "Speak naturally in English, Hindi or Telugu"}
              </span>
            </div>
            <div className="voice-actions">
              {!voiceActive ? (
                <button className="primary-button mic-button" onClick={startVoice} disabled={busy || loadingWorkspace || !assistantId}>
                  <Mic size={19} /> {busy ? "Preparing…" : "Start speaking"}
                </button>
              ) : (
                <>
                  {clientState === "speaking" && (
                    <button className="secondary-button" onClick={() => clientRef.current?.interrupt()}>
                      <VolumeX size={17} /> Interrupt
                    </button>
                  )}
                  <button className="secondary-button stop-button" onClick={stopVoice}>
                    <MicOff size={17} /> Stop session
                  </button>
                </>
              )}
            </div>
            <p className="permission-note">Microphone access starts only after you press “Start speaking”.</p>
          </div>

          <div className="controls-row">
            <label className="control-field">
              <Languages size={16} />
              <span>Language</span>
              <select value={language} onChange={(event) => changeLanguage(event.target.value)} disabled={voiceActive}>
                {Object.entries(LANGUAGE_LABELS).map(([code, label]) => {
                  const unavailable = code !== "auto" && Array.isArray(allowedLanguages) && !allowedLanguages.includes(code);
                  return <option key={code} value={code} disabled={unavailable}>{label}{unavailable ? " · unavailable" : ""}</option>;
                })}
              </select>
            </label>
            <label className="control-field">
              <Volume2 size={16} />
              <span>Voice</span>
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
          </div>
          {language === "te" && !canSpeakLanguage && (
            <div className="capability-note" role="status">
              Telugu recognition is available. Telugu speech output is not configured; replies will be shown as text.
            </div>
          )}
          {language === "auto" && voiceSettings && !canSpeakLanguage && (
            <div className="capability-note" role="status">
              Speech output is not available for the assistant’s configured default language. Text replies remain available.
            </div>
          )}

          <div className="transcript-panel" aria-live="polite">
            {!messages.length && !partial && !busy && (
              <div className="welcome-card">
                <span className="welcome-icon"><Bot size={19} /></span>
                <div><b>Your conversation starts here</b><p>Ask a question by voice or type below. Your history stays in this workspace.</p></div>
              </div>
            )}
            {messages.map((message, index) => (
              <article className={`message-card ${message.role}`} key={`${message.createdAt || "message"}-${index}`}>
                {message.role === "assistant" && <span className="message-avatar"><Bot size={15} /></span>}
                <div className="message-body">
                  <div className="message-meta">
                    <b>{message.role === "user" ? "YOU" : "MCZEN"}</b>
                    {message.language && <span>{LANGUAGE_LABELS[message.language] || message.language}</span>}
                  </div>
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
                </div>
              </article>
            ))}
            {partial && (
              <div className="partial-transcript"><span className="live-dot" />{partial}</div>
            )}
            {busy && <div className="thinking-indicator"><span /><span /><span /> McZEN is thinking</div>}
            <div ref={transcriptEnd} />
          </div>

          {(error || notice) && (
            <div className={`notice ${error ? "error-notice" : "info-notice"}`} role={error ? "alert" : "status"}>
              {error || notice}
              {error && <button onClick={() => setError("")} aria-label="Dismiss error">×</button>}
            </div>
          )}

          <form className="composer" onSubmit={submitText}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type a message instead…"
              aria-label="Message"
              maxLength={2000}
            />
            <button className="send-button" disabled={!input.trim() || busy || !selectedAssistant} aria-label="Send message">
              <Send size={17} />
            </button>
          </form>
          <footer className="assistant-footer">
            {connected ? <><Wifi size={13} /> Secure voice session active</> : <><WifiOff size={13} /> Voice is off until you start a session</>}
            {voiceSettings?.ttsEngineId && <span> · {voiceSettings.ttsEngineId}</span>}
          </footer>
        </section>
      </div>
    </main>
  );
}
