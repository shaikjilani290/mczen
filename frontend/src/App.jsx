import React, { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Bot,
  Languages,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
} from "lucide-react";

const API = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080"
).replace(/\/$/, "");

const locale = {
  en: "en-IN",
  te: "te-IN",
  hi: "hi-IN",
};

export default function App() {
  const [language, setLanguage] = useState("en");
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState("");

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm McZEN AI. Ask me a question or speak in English, Telugu or Hindi. Connect the verified product catalogue for product-specific answers.",
    },
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");

  const recognition = useRef(null);
  const end = useRef(null);

  // Load available browser voices and clean up on unmount.
  useEffect(() => {
    const loadVoices = () => {
      setVoices(window.speechSynthesis?.getVoices?.() || []);
    };

    loadVoices();

    window.speechSynthesis?.addEventListener?.(
      "voiceschanged",
      loadVoices
    );

    return () => {
      recognition.current?.abort?.();
      window.speechSynthesis?.cancel?.();

      window.speechSynthesis?.removeEventListener?.(
        "voiceschanged",
        loadVoices
      );
    };
  }, []);

  // Scroll to the newest message.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Filter voices according to the selected language.
  const available = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(language)
  );

  // Speak the assistant's response.
  function speak(text) {
    if (!window.speechSynthesis) {
      setError("Speech playback is not supported in this browser.");
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale[language];
    utterance.voice =
      available.find((v) => v.name === voice) ||
      available[0] ||
      null;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }

  // Send a message to the Node.js backend.
  async function send(text = input) {
    const message = text.trim();

    if (!message || busy) return;

    setInput("");
    setError("");

    const next = [
      ...messages,
      { role: "user", content: message },
    ];

    setMessages(next);
    setBusy(true);

    try {
      const history = next.slice(-9, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          language,
          history,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }

      if (typeof data.answer !== "string") {
        throw new Error("The backend returned an invalid response.");
      }

      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: data.answer },
      ]);

      speak(data.answer);
    } catch (err) {
      setError(
        `${err.message}. Ensure the backend and Ollama are running.`
      );
    } finally {
      setBusy(false);
    }
  }

  // Start browser speech recognition.
  function listen() {
    setError("");

    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError(
        "Speech recognition is not supported in this browser. Use text chat or add server-side speech-to-text."
      );
      return;
    }

    const currentRecognition = new SpeechRecognition();

    currentRecognition.lang = locale[language];
    currentRecognition.interimResults = true;
    currentRecognition.continuous = false;

    currentRecognition.onstart = () => {
      setListening(true);
    };

    currentRecognition.onerror = (event) => {
      setListening(false);

      setError(
        event.error === "not-allowed"
          ? "Please allow microphone access in your browser."
          : `Microphone error: ${event.error}`
      );
    };

    currentRecognition.onend = () => {
      setListening(false);
    };

    currentRecognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (finalText.trim()) {
        send(finalText.trim());
      } else if (interimText) {
        setInput(interimText);
      }
    };

    recognition.current = currentRecognition;

    try {
      currentRecognition.start();
    } catch (err) {
      setListening(false);
      setError(`Unable to start microphone: ${err.message}`);
    }
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel?.();
    setSpeaking(false);
  }

  function changeLanguage(value) {
    window.speechSynthesis?.cancel?.();
    setSpeaking(false);
    setLanguage(value);
    setVoice("");
  }

  return (
    <main className="page">
      <header className="top">
        <div className="logo">M</div>

        <div>
          <b>McZEN AI</b>
          <small>Voice assistant prototype</small>
        </div>

        <span className="status">● Local AI backend</span>
      </header>

      <section className="panel">
        <div className="panelhead">
          <div className="avatar">
            <AudioLines />
          </div>

          <div className="title">
            <h1>Ask McZEN</h1>
            <p>Your voice-powered shopping companion</p>
          </div>

          <button
            type="button"
            className="quiet"
            onClick={stopSpeaking}
            title="Stop audio"
            aria-label="Stop audio"
          >
            <VolumeX />
          </button>
        </div>

        <div className="settings">
          <label>
            <Languages size={16} />
            Language

            <select
              value={language}
              onChange={(event) =>
                changeLanguage(event.target.value)
              }
            >
              <option value="en">English</option>
              <option value="te">Telugu</option>
              <option value="hi">Hindi</option>
            </select>
          </label>

          <label>
            <Volume2 size={16} />
            Voice

            <select
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
            >
              <option value="">Default voice</option>

              {available.map((item) => (
                <option
                  key={`${item.name}-${item.lang}`}
                  value={item.name}
                >
                  {item.name} ({item.lang})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="hero">
          <div
            className={`orb ${
              listening ? "listen" : speaking ? "speak" : ""
            }`}
          >
            <AudioLines size={30} />
          </div>

          <p>
            {listening
              ? "Listening…"
              : busy
                ? "Thinking…"
                : speaking
                  ? "Speaking…"
                  : "Ready when you are"}
          </p>

          <button
            type="button"
            className="mic"
            disabled={busy}
            onClick={() =>
              listening
                ? recognition.current?.stop?.()
                : listen()
            }
          >
            {listening ? <MicOff /> : <Mic />}
            {listening ? "Stop listening" : "Tap to speak"}
          </button>
        </div>

        <div className="messages">
          {messages.map((message, index) => (
            <div
              className={`row ${message.role}`}
              key={index}
            >
              {message.role === "assistant" && (
                <span className="bot">
                  <Bot size={15} />
                </span>
              )}

              <div className="bubble">
                <small>
                  {message.role === "user" ? "YOU" : "MCZEN AI"}
                </small>

                <p>{message.content}</p>

                {message.role === "assistant" && (
                  <button
                    type="button"
                    className="play"
                    onClick={() => speak(message.content)}
                  >
                    <Volume2 size={14} />
                    Play response
                  </button>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <p className="thinking">McZEN AI is thinking…</p>
          )}

          <div ref={end} />
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask McZEN anything…"
            aria-label="Message McZEN AI"
          />

          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Send message"
          >
            <Send />
          </button>
        </form>

        <footer>
          Prototype · Browser voice availability varies by device
        </footer>
      </section>

      <p className="bottom">
        McZEN AI · Standalone integration prototype
      </p>
    </main>
  );
}
