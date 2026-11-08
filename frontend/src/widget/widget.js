import { createWidgetClient, resolveApiBase } from "./client.js";
import { createWidgetVoice, voiceSupport } from "./voice.js";

const LANG_LABELS = { en: "English", hi: "\u0939\u093f\u0928\u094d\u0926\u0940", te: "\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41" };
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
.voice-select{margin:8px 12px 0;max-width:calc(100% - 24px);padding:6px 8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--fg);font-size:12px}
header button{background:none;border:0;color:#fff;font-size:18px;cursor:pointer;padding:2px 6px}
.log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.m{max-width:85%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bub)}
.m.u{align-self:flex-end;background:var(--p);color:#fff}
.m.e{align-self:center;color:#b3261e;background:#b3261e18;font-size:13px}
.src{font-size:11px;color:var(--mut);margin-top:4px}
.product-cards{display:grid;gap:8px;margin-top:8px;max-width:100%}
.product-card{display:grid;grid-template-columns:72px 1fr;gap:9px;align-items:center;padding:8px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);color:var(--fg);text-decoration:none}
.product-card:hover{border-color:var(--p)}
.product-card img{width:72px;height:72px;object-fit:cover;border-radius:7px;background:var(--bub)}
.product-card-name{font-weight:600;font-size:13px}
.product-card-price{font-size:12px;color:var(--mut);margin-top:4px}
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

function chatIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24", width: "26", height: "26", fill: "none",
    stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round",
    "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
  })) svg.setAttribute(name, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z");
  svg.append(path);
  return svg;
}

export function mountWidget({ publicKey, assistantId, apiBase, integration = false, cartAdapter = null, productContext }) {
  if (document.getElementById("mczen-widget-host")) return null;
  const client = createWidgetClient({ apiBase, publicKey, assistantId, integration, cartAdapter, productContext,
    onCartError: message => add(message, "e") });
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
  const input = el("input", { type: "text", maxlength: "2000", placeholder: "Type your message\u2026", "aria-label": "Message" });
  const sendBtn = el("button", { type: "submit" }, "Send");
  sendBtn.disabled = true;
  const note = el("div", { class: "note" });
  const vstate = el("div", { class: "vstate", "aria-live": "polite" });
  const mic = el("button", { type: "button", class: "mic", "aria-label": "Start voice", "aria-pressed": "false" }, "🎤");
  const stopBtn = el("button", { type: "button", class: "stop", "aria-label": "Stop assistant speaking" }, "Stop");
  mic.hidden = true;
  stopBtn.hidden = true;
  const select = el("select", { "aria-label": "Language" });
  const voiceSelect = el("select", { "aria-label": "Assistant voice", class: "voice-select" });
  voiceSelect.hidden = true;
  const title = el("b", {}, "Assistant");
  const logo = el("img", { alt: "" });
  logo.hidden = true;
  const panel = el("div", { class: "panel", role: "dialog", "aria-label": "Assistant chat" });
  panel.hidden = true;
  const fab = el("button", { class: "fab", "aria-label": "Open assistant", "aria-expanded": "false" }, chatIcon());

  const add = (text, cls, sources, products = []) => {
    const m = el("div", { class: `m ${cls}` }, text);
    if (sources?.length) m.append(el("div", { class: "src" }, `Sources: ${sources.map((s) => s.title || s.name || "source").join(", ")}`));
    const cards = products.map((product) => {
      if (!product || typeof product.name !== "string" || typeof product.productUrl !== "string") return null;
      let link;
      try { link = new URL(product.productUrl); } catch { return null; }
      if (!["https:", "http:"].includes(link.protocol) || link.username || link.password) return null;
      const card = el("a", { class: "product-card", href: link.toString(), target: "_blank", rel: "noopener noreferrer" });
      if (Array.isArray(product.images) && typeof product.images[0] === "string") {
        try {
          const image = new URL(product.images[0]);
          if (["https:", "http:"].includes(image.protocol) && !image.username && !image.password) {
            card.append(el("img", { src: image.toString(), alt: product.name, loading: "lazy", referrerpolicy: "no-referrer" }));
          }
        } catch { /* Invalid imported image URLs are omitted. */ }
      }
      const details = el("div", {});
      details.append(el("div", { class: "product-card-name" }, product.name.slice(0, 200)));
      const amount = typeof product.salePrice === "number" ? product.salePrice : product.price;
      if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0 &&
          typeof product.currency === "string" && /^[A-Z]{3}$/.test(product.currency)) {
        let price;
        try { price = new Intl.NumberFormat(undefined, { style: "currency", currency: product.currency }).format(amount); }
        catch { price = `${amount} ${product.currency}`; }
        details.append(el("div", { class: "product-card-price" }, price));
      }
      card.append(details);
      return card;
    }).filter(Boolean);
    if (cards.length) m.append(el("div", { class: "product-cards" }, ...cards));
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
    sendBtn.disabled = false;
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
    const options = (config?.voice?.voices || []).filter((option) => option.language === language);
    voiceSelect.replaceChildren(el("option", { value: "" }, "Default voice"),
      ...options.map((option) => el("option", { value: option.id }, option.label || option.id)));
    voiceSelect.hidden = !support.ok || options.length === 0;
    if (!config?.voice?.available) return;
    try {
      const saved = localStorage.getItem(`mczen-voice:${assistantId}:${language}`);
      if (saved && options.some((option) => option.id === saved)) voiceSelect.value = saved;
      else if (saved) {
        localStorage.removeItem(`mczen-voice:${assistantId}:${language}`);
        note.textContent = "Your previous voice is unavailable. Using the assistant default.";
      }
    } catch { console.warn("[McZEN] Voice preference storage is unavailable; using the assistant default."); }
  }

  async function init() {
    started = true;
    const loading = add("Loading\u2026", "e");
    try {
      applyConfig(await client.start());
      loading.remove();
      if (config.welcomeMessage) add(config.welcomeMessage, "");
      if (config.greeting) add(config.greeting, "");
      if (integration) void trackPage().catch((error) => console.error("McZEN page tracking failed.", error));
    } catch (error) {
      loading.textContent = error.message;
      started = false;
      fab.style.display = error.code === "unavailable" ? "none" : "";
    }
  }

  const STATE_TEXT = { connecting: "Connecting…", requesting_microphone: "Starting microphone — allow access if prompted…", listening: "Listening…", transcribing: "Transcribing…", processing: "Thinking…", speaking: "Speaking…", interrupted: "Stopped", reconnecting: "Reconnecting…", error: "" };
  let streamedMessage = null;
  const voice = createWidgetVoice({
    client,
    apiBase,
    onState: (s) => {
      if (["idle", "error", "interrupted"].includes(s)) streamedMessage = null;
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
    onFinal: (text) => { streamedMessage = null; partialEl?.remove(); partialEl = null; if (text) add(text, "u"); },
    onDelta: (text) => {
      if (!text) return;
      if (!streamedMessage) streamedMessage = add(text, "");
      else streamedMessage.firstChild.textContent += ` ${text}`;
      log.scrollTop = log.scrollHeight;
    },
    onResponse: (text, sources, products) => {
      streamedMessage?.remove();
      streamedMessage = null;
      add(text, "", sources, products);
    },
    onError: (message) => add(message, "e"),
  });
  mic.addEventListener("click", () => { if (voice.isActive()) void voice.stop(); else void voice.start(language, voiceSelect.value); });
  stopBtn.addEventListener("click", () => voice.interrupt());
  select.addEventListener("change", () => { void voice.stop(); language = select.value; updateNote(); });
  voiceSelect.addEventListener("change", () => {
    void voice.stop();
    try { localStorage.setItem(`mczen-voice:${assistantId}:${language}`, voiceSelect.value); }
    catch { note.textContent = "Voice selected for this visit; browser storage is unavailable."; }
  });

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
    const wait = el("div", { class: "dots" }, "\u2026");
    log.append(wait);
    try {
      const reply = await client.send(text, language);
      wait.remove();
      add(reply.answer || "", "", reply.sources, reply.products);
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

  const trackPage = () => client.trackPageView();
  const trackNavigation = () => {
    if (started && integration) void trackPage().catch((error) => console.error("McZEN page tracking failed.", error));
  };
  window.addEventListener("popstate", trackNavigation);
  window.addEventListener("hashchange", trackNavigation);
  const destroy = () => {
    client.destroy();
    void voice.stop();
    window.removeEventListener("popstate", trackNavigation);
    window.removeEventListener("hashchange", trackNavigation);
    host.remove();
  };

  const header = el("header", {}, logo, title, select,
    el("button", { "aria-label": "Minimize", onclick: () => setOpen(false) }, "\u2013"),
    el("button", { "aria-label": "Close", onclick: () => { setOpen(false); destroy(); } }, "\u00d7"));
  panel.append(header, voiceSelect, log, vstate, note, form);
  fab.addEventListener("click", () => setOpen(panel.hidden));
  root.append(panel, fab);
  updateNote();
  return { trackPage, destroy };
}
