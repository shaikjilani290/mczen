import { createWidgetClient, resolveApiBase } from "./client.js";
import { createWidgetVoice, voiceSupport } from "./voice.js";

const LANG_LABELS = { en: "English", hi: "à¤¹à¤¿à¤¨à¥à¤¦à¥€", te: "à°¤à±†à°²à±à°—à±" };
const RADIUS = { round: "50%", pill: "999px", square: "12px" };
const COLOR = /^#[0-9a-fA-F]{6}$/;

const STYLE = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.root{--p:#8e5be1;--bg:#fff;--fg:#1c1726;--mut:#6b6478;--bd:#e4dff0;--bub:#f1edf8;position:fixed;bottom:20px;z-index:2147483000;color:var(--fg)}
.root.dark{--bg:#1b1626;--fg:#f4f0fa;--mut:#a79bb9;--bd:#352d45;--bub:#2a2238}
.root.right{right:20px}.root.left{left:20px}
.fab{width:56px;height:56px;border:0;background:var(--p);color:#fff;cursor:pointer;box-shadow:0 6px 20px #0004;font-size:24px;display:flex;align-items:center;justify-content:center;gap:8px}
.fab.pill{width:auto;padding:0 20px;font-size:15px;height:48px}
.panel{position:absolute;bottom:68px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 100px);background:var(--bg);border:1px solid var(--bd);border-radius:16px;box-shadow:0 12px 40px #0005;display:flex;flex-direction:column;overflow:hidden}
.right .panel{right:0}.left .panel{left:0}
.panel[hidden]{display:none}
header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--p);color:#fff}
header img{width:28px;height:28px;border-radius:50%;object-fit:cover}
header b{flex:1;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
header select{background:#fff3;color:#fff;border:0;border-radius:6px;padding:3px;font-size:12px}
header select option{color:#000}
header button{background:none;border:0;color:#fff;font-size:18px;cursor:pointer;padding:2px 6px}
.log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.m{max-width:85%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bub)}
.m.u{align-self:flex-end;background:var(--p);color:#fff}
.m.e{align-self:center;color:#b3261e;background:#b3261e18;font-size:13px}
.src{font-size:11px;color:var(--mut);margin-top:4px}
.note{font-size:11px;color:var(--mut);padding:0 12px 6px}
form{display:flex;gap:6px;padding:10px;border-top:1px solid var(--bd)}
input{flex:1;min-width:0;padding:9px 12px;border:1px solid var(--bd);border-radius:999px;background:var(--bg);color:var(--fg);font-size:14px}
form button{border:0;background:var(--p);color:#fff;border-radius:999px;padding:0 16px;cursor:pointer}
form button:disabled{opacity:.5;cursor:not-allowed}
.mic{border:0;background:var(--bub);color:var(--fg);border-radius:999px;width:38px;cursor:pointer;font-size:16px}
.mic.on{background:#b3261e;color:#fff}
.mic[hidden],.stop[hidden]{display:none}
.stop{border:1px solid var(--bd);background:none;color:var(--fg);border-radius:999px;padding:0 10px;cursor:pointer;font-size:12px}
.vstate{font-size:12px;color:var(--mut);padding:0 12px 4px;min-height:16px}
.m.p{opacity:.7;align-self:flex-end;font-style:italic}
.dots{align-self:flex-start;color:var(--mut);font-size:13px}
@media(max-width:520px){.panel{position:fixed;inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}}
@media(prefers-reduced-motion:no-preference){.fab{transition:transform .15s}.fab:hover{transform:scale(1.06)}}
`;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

export function mountWidget({ publicKey, apiBase }) {
  if (document.getElementById("mczen-widget-host")) return;
  const client = createWidgetClient({ apiBase, publicKey });
  const host = el("div", { id: "mczen-widget-host" });
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.append(el("style", {}, STYLE));
  document.body.append(host);

  let config = null;
  let language = "en";
  let busy = false;
  let started = false;
  let partialEl = null;
  const root = el("div", { class: "root right" });
  shadow.append(root);

  const log = el("div", { class: "log", "aria-live": "polite" });
  const input = el("input", { type: "text", maxlength: "2000", placeholder: "Type your messageâ€¦", "aria-label": "Message" });
  const sendBtn = el("button", { type: "submit" }, "Send");
  const note = el("div", { class: "note" });
  const vstate = el("div", { class: "vstate", "aria-live": "polite" });
  const mic = el("button", { type: "button", class: "mic", "aria-label": "Start voice", "aria-pressed": "false" }, "🎤");
  const stopBtn = el("button", { type: "button", class: "stop", "aria-label": "Stop assistant speaking" }, "Stop");
  mic.hidden = true;
  stopBtn.hidden = true;
  const select = el("select", { "aria-label": "Language" });
  const title = el("b", {}, "Assistant");
  const logo = el("img", { alt: "" });
  logo.hidden = true;
  const panel = el("div", { class: "panel", role: "dialog", "aria-label": "Assistant chat" });
  panel.hidden = true;
  const fab = el("button", { class: "fab", "aria-label": "Open assistant", "aria-expanded": "false" }, "ðŸ’¬");

  const add = (text, cls, sources) => {
    const m = el("div", { class: `m ${cls}` }, text);
    if (sources?.length) m.append(el("div", { class: "src" }, `Sources: ${sources.map((s) => s.title || s.name || "source").join(", ")}`));
    log.append(m);
    log.scrollTop = log.scrollHeight;
    return m;
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    if (!open) void voice.stop();
    fab.setAttribute("aria-expanded", String(open));
    if (open && !started) init();
    if (open) input.focus();
  };

  function applyConfig(c) {
    config = c;
    if (COLOR.test(c.primaryColor || "")) root.style.setProperty("--p", c.primaryColor);
    const dark = c.theme === "dark" || (c.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    root.className = `root ${c.position === "bottom-left" ? "left" : "right"}${dark ? " dark" : ""}`;
    fab.className = `fab ${c.buttonStyle === "pill" ? "pill" : ""}`;
    fab.style.borderRadius = RADIUS[c.buttonStyle] || RADIUS.round;
    title.textContent = c.name || "Assistant";
    if (typeof c.logoUrl === "string" && c.logoUrl.startsWith("https://")) { logo.src = c.logoUrl; logo.hidden = false; }
    select.replaceChildren(...c.languages.map((l) => el("option", { value: l }, LANG_LABELS[l] || l)));
    language = c.defaultLanguage;
    select.value = language;
    updateNote();
  }

  function updateNote() {
    const support = voiceSupport(config?.voice, language);
    mic.hidden = !support.ok;
    if (!support.ok && voice.isActive()) void voice.stop();
    note.textContent = support.ok ? "" : support.reason;
  }

  async function init() {
    started = true;
    const loading = add("Loadingâ€¦", "e");
    try {
      applyConfig(await client.start());
      loading.remove();
      if (config.welcomeMessage) add(config.welcomeMessage, "");
      if (config.greeting) add(config.greeting, "");
    } catch (error) {
      loading.textContent = error.message;
      started = false;
      fab.style.display = error.code === "unavailable" ? "none" : "";
    }
  }

  const STATE_TEXT = { connecting: "Connecting…", listening: "Listening…", transcribing: "Transcribing…", processing: "Thinking…", speaking: "Speaking…", interrupted: "Stopped", reconnecting: "Reconnecting…", error: "" };
  const voice = createWidgetVoice({
    client,
    apiBase,
    onState: (s) => {
      vstate.textContent = STATE_TEXT[s] || "";
      const live = s !== "idle" && s !== "error";
      mic.classList.toggle("on", live);
      mic.setAttribute("aria-pressed", String(live));
      mic.setAttribute("aria-label", live ? "Stop voice" : "Start voice");
      stopBtn.hidden = s !== "speaking";
      if (s === "error") void voice.stop();
    },
    onPartial: (text) => {
      if (!text) { partialEl?.remove(); partialEl = null; return; }
      if (!partialEl) partialEl = add(text, "u p"); else partialEl.firstChild.textContent = text;
      log.scrollTop = log.scrollHeight;
    },
    onFinal: (text) => { partialEl?.remove(); partialEl = null; if (text) add(text, "u"); },
    onResponse: (text, sources) => add(text, "", sources),
    onError: (message) => add(message, "e"),
  });
  mic.addEventListener("click", () => { if (voice.isActive()) void voice.stop(); else void voice.start(language); });
  stopBtn.addEventListener("click", () => voice.interrupt());
  select.addEventListener("change", () => { language = select.value; updateNote(); });

  const form = el("form", {});
  form.append(mic, stopBtn, input, sendBtn);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy || !config) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    add(text, "u");
    const wait = el("div", { class: "dots" }, "â€¦");
    log.append(wait);
    try {
      const reply = await client.send(text, language);
      wait.remove();
      add(reply.answer || "", "", reply.sources);
    } catch (error) {
      wait.remove();
      add(error.message, "e");
      if (error.code === "expired") started = false;
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });

  const header = el("header", {}, logo, title, select,
    el("button", { "aria-label": "Minimize", onclick: () => setOpen(false) }, "â€“"),
    el("button", { "aria-label": "Close", onclick: () => { setOpen(false); host.remove(); } }, "Ã—"));
  panel.append(header, log, vstate, note, form);
  fab.addEventListener("click", () => setOpen(panel.hidden));
  root.append(panel, fab);
  updateNote();
}
