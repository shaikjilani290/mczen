import { createWidgetClient, resolveApiBase } from "./client.js";
import { createWidgetVoice, voiceSupport } from "./voice.js";

const LANG_LABELS = { en: "English", hi: "\u0939\u093f\u0928\u094d\u0926\u0940", te: "\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41" };
const RADIUS = { round: "50%", pill: "999px", square: "14px" };
const COLOR = /^#[0-9a-fA-F]{6}$/;
const SVG_NS = "http://www.w3.org/2000/svg";

const STYLE = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.root{--p:#0f766e;--bg:#08151a;--fg:#eaf7f4;--mut:#8fadaa;--bd:#ffffff1f;--bub:#ffffff0f;position:fixed;bottom:20px;z-index:2147483000;color:var(--fg)}
.root.dark{--bg:#08151a;--fg:#eaf7f4;--mut:#8fadaa;--bd:#ffffff1f;--bub:#ffffff0f}
.root.right{right:20px}.root.left{left:20px}
.fab{width:56px;height:56px;border:1px solid #ffffff2b;background:linear-gradient(145deg,color-mix(in srgb,var(--p) 55%,#5df0d4),var(--p));color:#042a26;cursor:pointer;box-shadow:0 12px 30px color-mix(in srgb,var(--p) 45%,transparent),0 4px 14px #0007;font-size:24px;display:flex;align-items:center;justify-content:center;gap:8px}
.fab svg{width:26px;height:26px}
.fab.pill{width:auto;padding:0 20px;font-size:15px;height:48px}
.panel{position:absolute;bottom:70px;width:390px;max-width:calc(100vw - 24px);height:650px;max-height:calc(100dvh - 110px);background:radial-gradient(ellipse 110% 50% at 45% -15%,color-mix(in srgb,var(--p) 65%,#08151a),transparent),#080e10;border:1px solid #ffffff26;border-radius:34px;box-shadow:0 30px 80px #0008,0 0 40px color-mix(in srgb,var(--p) 12%,transparent),inset 0 0 0 5px #ffffff05;display:flex;flex-direction:column;overflow:hidden}
.right .panel{right:0}.left .panel{left:0}
.panel[hidden]{display:none}
header{display:flex;align-items:center;gap:9px;padding:24px 20px 16px;color:var(--fg);background:none}
header img{width:30px;height:30px;border-radius:10px;object-fit:cover;border:1px solid var(--bd)}
header b{flex:1;min-width:0;font-size:14px;font-weight:600;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
header b::before{content:"McZEN AI";display:block;font-size:9px;font-weight:500;letter-spacing:.16em;color:var(--mut);margin-bottom:4px}
header select{appearance:none;background:#ffffff10;color:var(--fg);border:1px solid var(--bd);border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer;max-width:96px}
header select option{color:#0b1a1e;background:#fff}
header button{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:none;border:1px solid var(--bd);border-radius:50%;background:#ffffff08;color:var(--fg);font-size:15px;line-height:1;cursor:pointer;padding:0 0 2px}
header button:hover{background:#ffffff16}
.voice-select{margin:2px 14px 0;max-width:calc(100% - 28px);padding:7px 10px;border:1px solid var(--bd);border-radius:12px;background:#ffffff0a;color:var(--fg);font-size:12px}
.log{flex:1;min-height:0;overflow-y:auto;padding:14px 20px 24px;display:flex;flex-direction:column;gap:18px;scrollbar-width:thin;scrollbar-color:#ffffff26 transparent}
.log::-webkit-scrollbar{width:6px}
.log::-webkit-scrollbar-thumb{background:#ffffff26;border-radius:999px}
.m{max-width:100%;padding:0;border-radius:0;font-size:14px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;background:transparent;border:0}
.m.u{max-width:86%;align-self:flex-end;padding:13px 16px;border:1px solid #ffffff26;border-radius:22px 22px 6px 22px;background:linear-gradient(135deg,#ffffff0c,#ffffff03);color:var(--fg)}
.m.e{padding:10px 13px;border-radius:14px;border:1px solid #b3261e40}
.m.e{align-self:center;color:#ffb4aa;background:#b3261e24;border-color:#b3261e40;font-size:13px}
.src{font-size:11px;color:var(--mut);margin-top:6px}
.product-cards{display:grid;gap:8px;margin-top:10px;max-width:100%}
.product-card{display:grid;grid-template-columns:1fr 30px;gap:12px;align-items:center;padding:8px 8px 13px;border:1px solid var(--bd);border-radius:22px;background:linear-gradient(145deg,#ffffff0a,#ffffff02);color:var(--fg);text-decoration:none;white-space:normal}
.product-card:hover{border-color:color-mix(in srgb,var(--p) 60%,#ffffff);background:#ffffff10}
.product-card img{grid-column:1/-1;width:100%;height:160px;object-fit:contain;border-radius:15px;background:#ffffffed}
.product-card>div{padding-left:6px}
.product-card-name{font-weight:600;font-size:13px;line-height:1.35}
.product-card-price{font-size:12px;color:var(--mut);margin-top:5px}
.product-card-go{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:color-mix(in srgb,var(--p) 70%,#0b2a28);color:#eafffb;font-size:13px;line-height:1}
.note{font-size:11px;color:var(--mut);padding:0 16px 6px}
form{display:flex;align-items:center;gap:8px;margin:0 18px 22px;padding:5px 5px 5px 18px;border:1px solid #ffffff1a;border-radius:999px;background:linear-gradient(120deg,#ffffff13,#ffffff08);box-shadow:inset 0 1px 0 #ffffff08}
input{flex:1;min-width:0;padding:10px 0;border:0;background:none;color:var(--fg);font-size:14px;outline:none}
input::placeholder{color:var(--mut)}
form button{border:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none}
.mic{width:42px;height:42px;border-radius:50%;background:linear-gradient(145deg,color-mix(in srgb,var(--p) 55%,#5df0d4),var(--p));color:#042a26;box-shadow:0 6px 18px color-mix(in srgb,var(--p) 45%,transparent)}
.mic svg,.send svg{width:19px;height:19px}
.mic.on{background:#b3261e;color:#fff;box-shadow:0 0 0 6px #b3261e2e}
.mic[hidden],.stop[hidden]{display:none}
.send{display:none;width:42px;height:42px;border-radius:50%;background:linear-gradient(145deg,color-mix(in srgb,var(--p) 55%,#5df0d4),var(--p));color:#042a26}
form.has-text .send{display:inline-flex}
form.has-text .mic{display:none}
.send:disabled{opacity:.45;cursor:not-allowed}
button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid #79e7d4;outline-offset:3px}
form:focus-within{border-color:color-mix(in srgb,var(--p) 65%,#ffffff)}
.stop{padding:7px 10px;border-radius:999px;background:#ffffff16;color:var(--fg);font-size:11px}
.note:empty{display:none}
.vstate{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.m.p{opacity:.7;align-self:flex-end;font-style:italic}
.dots{align-self:flex-start;color:var(--mut);font-size:13px;padding:2px 6px}
.listen{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;padding:24px 24px 38px;background:radial-gradient(ellipse 110% 55% at 50% -15%,color-mix(in srgb,var(--p) 85%,#092a26),transparent),#080e10;animation:listen-in .22s ease-out}
.listen[hidden]{display:none}
.listen-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.listen-top button{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid var(--bd);border-radius:50%;background:#ffffff0a;color:var(--fg);cursor:pointer}
.listen-top button:hover{background:#ffffff16}
.listen-pill{display:flex;align-items:center;gap:8px;padding:7px 13px;border:1px solid var(--bd);border-radius:999px;background:#ffffff0d;font-size:12px;color:var(--fg)}
.listen-pill b{font-weight:600}
.listen-pill em{font-style:normal;font-size:10px;letter-spacing:.03em;padding:2px 7px;border-radius:999px;background:#ffffff1c}
.listen-main{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;gap:20px;padding:28px 0 20px}
.orb{position:relative;flex-shrink:0;width:min(174px,42vw,29dvh);aspect-ratio:1;border-radius:50%;display:grid;place-items:center}
.orb-glow{position:absolute;inset:-18%;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--p) 70%,#3fe0c2) 0%,transparent 68%);filter:blur(18px);opacity:.55;animation:orb-glow 5s ease-in-out infinite}
.orb-core{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 34% 26%,#f4fffd 0%,color-mix(in srgb,var(--p) 34%,#eafffb) 16%,color-mix(in srgb,var(--p) 64%,#7cf3de) 40%,#0a5c58 70%,#04282c 90%,transparent 100%);box-shadow:0 0 70px color-mix(in srgb,var(--p) 55%,transparent),inset 0 0 54px #00000040,inset 14px -16px 46px #021f2299;animation:orb-breathe 4.5s ease-in-out infinite}
.orb-ring{position:absolute;border-radius:50%;mix-blend-mode:screen;pointer-events:none}
.orb-ring.r1{inset:5%;border:3px solid #d9fff8b0;box-shadow:0 0 12px #9bffe8;transform:rotate(-26deg) scaleY(.34);animation:ring-a 7s ease-in-out infinite}
.orb-ring.r2{inset:3%;border:4px solid #bcfcee99;filter:blur(1px);transform:rotate(44deg) scaleY(.42);animation:ring-b 9s ease-in-out infinite}
.orb-ring.r3{inset:16%;border:3px solid #f0fffc6b;filter:blur(1.5px);transform:rotate(8deg) scaleY(.26);animation:ring-c 11s ease-in-out infinite}
.listen-copy{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.listen-prompt{margin:0;font-size:14px;line-height:1.6;color:#d7ece8;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;max-width:300px}
.listen-state{margin:0;font-size:13px;letter-spacing:.02em;color:color-mix(in srgb,var(--p) 35%,#a9fff0);display:flex;align-items:center;gap:8px}
.listen-state::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 10px currentColor;animation:dot-pulse 1.6s ease-in-out infinite}
.listen-actions{display:flex;align-items:center;justify-content:center;gap:38px;padding-top:4px}
.listen-btn{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;border:1px solid var(--bd);background:#ffffff0d;color:#e3f6f1;cursor:pointer}
.listen-btn:hover{background:#ffffff18}
.listen-btn svg{width:20px;height:20px}
.listen-mic{position:relative;width:64px;height:64px;border:0;background:radial-gradient(circle at 34% 28%,#7ffff0,#1fc9ae 52%,var(--p));color:#03231f;box-shadow:0 0 0 8px #ffffff0f,0 0 44px color-mix(in srgb,var(--p) 70%,transparent)}
.listen-mic svg{width:24px;height:24px}
.listen-mic::after{content:"";position:absolute;inset:-8px;border-radius:50%;border:1px solid #9bffe84f;animation:mic-pulse 2.4s ease-out infinite}
.listen-state{justify-content:center;flex-shrink:0;margin:0 0 28px;font-size:12px;color:var(--mut)}
.speaking .orb-core{animation-duration:1.2s}
.listen[data-state="processing"] .orb-ring{animation-duration:2s}
.listen[data-state="connecting"] .listen-mic::after,.listen[data-state="requesting_microphone"] .listen-mic::after{animation:none}
@keyframes listen-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}
@keyframes orb-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
@keyframes orb-glow{0%,100%{opacity:.45;transform:scale(.97)}50%{opacity:.7;transform:scale(1.04)}}
@keyframes ring-a{0%,100%{transform:rotate(-26deg) scaleY(.34) translateY(-4%)}50%{transform:rotate(-6deg) scaleY(.42) translateY(4%)}}
@keyframes ring-b{0%,100%{transform:rotate(44deg) scaleY(.42) translateY(3%)}50%{transform:rotate(70deg) scaleY(.34) translateY(-3%)}}
@keyframes ring-c{0%,100%{transform:rotate(8deg) scaleY(.26)}50%{transform:rotate(-16deg) scaleY(.34)}}
@keyframes dot-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes mic-pulse{0%{transform:scale(.9);opacity:.8}70%{transform:scale(1.22);opacity:0}100%{transform:scale(1.22);opacity:0}}
@media(max-width:520px){.panel{position:fixed;inset:auto 10px max(10px,env(safe-area-inset-bottom));width:auto;max-width:none;height:calc(100dvh - 20px - env(safe-area-inset-top) - env(safe-area-inset-bottom));max-height:760px;border-radius:30px}.listen{padding-bottom:max(30px,env(safe-area-inset-bottom))}.fab[aria-expanded="true"]{visibility:hidden}}
@media(max-height:500px){.listen-main{flex-direction:row;padding:10px 0;gap:18px}.orb{width:100px}.listen-state{margin-bottom:12px}.listen{padding-top:14px;padding-bottom:18px}}
@media(prefers-reduced-motion:no-preference){.fab{transition:transform .15s,box-shadow .15s}.fab:hover{transform:scale(1.06)}}
@media(prefers-reduced-motion:reduce){.listen,.orb-core,.orb-glow,.orb-ring,.listen-mic::after,.listen-state::before{animation:none}}
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

function svgIcon(paths, size = 20) {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24", width: String(size), height: String(size), fill: "none",
    stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round",
    "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false",
  })) svg.setAttribute(name, value);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const ICONS = {
  chat: ["M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"],
  mic: ["M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v1a7 7 0 0 1-14 0v-1", "M12 18v4"],
  send: ["M22 2 11 13", "M22 2 15 22l-4-9-9-4Z"],
  speaker: ["M11 5 6 9H2v6h4l5 4V5Z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"],
  keyboard: ["M4 3h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
    "M6 8h.01", "M10 8h.01", "M14 8h.01", "M18 8h.01", "M8 12h.01", "M12 12h.01", "M16 12h.01", "M20 12h.01", "M6 16h.01", "M18 16h.01", "M8 20h8"],
  back: ["M19 12H5", "m12 19-7-7 7-7"],
};

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
  let lastUserText = "";
  const root = el("div", { class: "root right" });
  shadow.append(root);

  const log = el("div", { class: "log", "aria-live": "polite" });
  const input = el("input", { type: "text", maxlength: "2000", placeholder: "Ask anything", "aria-label": "Ask anything" });
  const sendBtn = el("button", { type: "submit", class: "send", "aria-label": "Send message" }, svgIcon(ICONS.send, 19));
  sendBtn.disabled = true;
  const note = el("div", { class: "note" });
  const vstate = el("div", { class: "vstate", "aria-live": "polite" });
  const mic = el("button", { type: "button", class: "mic", "aria-label": "Start voice", "aria-pressed": "false" }, svgIcon(ICONS.mic, 19));
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
  const fab = el("button", { class: "fab", "aria-label": "Open assistant", "aria-expanded": "false" }, svgIcon(ICONS.chat, 26));

  const prompt = el("p", { class: "listen-prompt" }, "What are you looking for today?");
  const listenState = el("p", { class: "listen-state", "aria-live": "polite" }, "I'm Listening");
  const backBtn = el("button", { type: "button", "aria-label": "Back to chat" }, svgIcon(ICONS.back, 20));
  const speakerBtn = el("button", { type: "button", class: "listen-btn", "aria-label": "Stop assistant speaking" }, svgIcon(ICONS.speaker, 20));
  const listenMic = el("button", { type: "button", class: "listen-btn listen-mic", "aria-label": "Stop listening" }, svgIcon(ICONS.mic, 24));
  const keyboardBtn = el("button", { type: "button", class: "listen-btn", "aria-label": "Type instead" }, svgIcon(ICONS.keyboard, 20));
  const listening = el("div", { class: "listen", role: "region", "aria-label": "Voice assistant" },
    el("div", { class: "listen-top" }, backBtn,
      el("div", { class: "listen-pill" }, el("b", {}, "McZEN AI"), el("em", {}, "Voice")),
      el("span", { style: "width:38px" })),
    el("div", { class: "listen-main" },
      el("div", { class: "orb", "aria-hidden": "true" },
        el("span", { class: "orb-glow" }), el("span", { class: "orb-core" }),
        el("span", { class: "orb-ring r1" }), el("span", { class: "orb-ring r2" }), el("span", { class: "orb-ring r3" })),
      el("div", { class: "listen-copy" }, prompt)),
    listenState,
    el("div", { class: "listen-actions" }, speakerBtn, listenMic, keyboardBtn));
  listening.hidden = true;

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
      card.append(details, el("span", { class: "product-card-go", "aria-hidden": "true" }, "\u2197"));
      return card;
    }).filter(Boolean);
    if (cards.length) m.append(el("div", { class: "product-cards" }, ...cards));
    log.append(m);
    log.scrollTop = log.scrollHeight;
    return m;
  };

  const setListeningPrompt = (text) => {
    const value = (text || lastUserText || "").replace(/\s+/g, " ").trim();
    prompt.textContent = value ? (value.length > 260 ? `${value.slice(0, 260)}\u2026` : value) : "What are you looking for today?";
  };
  const openListening = () => {
    setListeningPrompt(lastUserText);
    listening.hidden = false;
    panel.classList.add("listening");
    header.inert = true;
    log.inert = true;
    form.inert = true;
    voiceSelect.inert = true;
  };
  const closeListening = () => {
    const restoreFocus = listening.contains(shadow.activeElement);
    listening.hidden = true;
    panel.classList.remove("listening", "speaking");
    header.inert = false;
    log.inert = false;
    form.inert = false;
    voiceSelect.inert = false;
    if (restoreFocus && !panel.hidden) input.focus();
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    if (!open) { void voice.stop(); closeListening(); }
    fab.setAttribute("aria-expanded", String(open));
    if (open && !started) init();
    if (open) input.focus();
    else fab.focus();
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

  const STATE_TEXT = { connecting: "Connecting\u2026", requesting_microphone: "Starting microphone \u2014 allow access if prompted\u2026", listening: "I'm Listening", transcribing: "Transcribing\u2026", processing: "Thinking\u2026", speaking: "Speaking\u2026", interrupted: "Stopped", reconnecting: "Reconnecting\u2026", error: "" };
  let streamedMessage = null;
  const voice = createWidgetVoice({
    client,
    apiBase,
    onState: (s) => {
      if (["idle", "error", "interrupted"].includes(s)) streamedMessage = null;
      vstate.textContent = STATE_TEXT[s] || "";
      listening.dataset.state = s;
      const live = s !== "idle" && s !== "error";
      if (live) {
        openListening();
        backBtn.focus();
        listenState.textContent = STATE_TEXT[s] || "I'm Listening";
      } else {
        closeListening();
      }
      panel.classList.toggle("speaking", s === "speaking");
      mic.classList.toggle("on", live);
      mic.setAttribute("aria-pressed", String(live));
      mic.setAttribute("aria-label", live ? "Stop voice" : "Start voice");
      stopBtn.hidden = s !== "speaking";
      if (s === "error") void voice.stop();
    },
    onPartial: (text) => {
      if (!text) { partialEl?.remove(); partialEl = null; return; }
      if (!partialEl) partialEl = add(text, "u p"); else partialEl.firstChild.textContent = text;
      setListeningPrompt(text);
      log.scrollTop = log.scrollHeight;
    },
    onFinal: (text) => {
      streamedMessage = null;
      partialEl?.remove();
      partialEl = null;
      if (text) { lastUserText = text; setListeningPrompt(text); add(text, "u"); }
    },
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
  mic.addEventListener("click", () => {
    if (voice.isActive()) { void voice.stop(); closeListening(); return; }
    openListening();
    void voice.start(language, voiceSelect.value);
  });
  stopBtn.addEventListener("click", () => voice.interrupt());
  speakerBtn.addEventListener("click", () => voice.interrupt());
  listenMic.addEventListener("click", () => { void voice.stop(); closeListening(); });
  keyboardBtn.addEventListener("click", () => { void voice.stop(); closeListening(); input.focus(); });
  backBtn.addEventListener("click", () => { void voice.stop(); closeListening(); input.focus(); });
  select.addEventListener("change", () => { void voice.stop(); language = select.value; updateNote(); });
  voiceSelect.addEventListener("change", () => {
    void voice.stop();
    try { localStorage.setItem(`mczen-voice:${assistantId}:${language}`, voiceSelect.value); }
    catch { note.textContent = "Voice selected for this visit; browser storage is unavailable."; }
  });

  const form = el("form", {});
  form.append(input, stopBtn, mic, sendBtn);
  input.addEventListener("input", () => form.classList.toggle("has-text", input.value.trim().length > 0));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy || !config) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    form.classList.remove("has-text");
    lastUserText = text;
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
  const onKeyDown = (event) => {
    if (event.key === "Escape" && !listening.hidden) { void voice.stop(); closeListening(); input.focus(); }
  };
  window.addEventListener("popstate", trackNavigation);
  window.addEventListener("hashchange", trackNavigation);
  window.addEventListener("keydown", onKeyDown);
  const destroy = () => {
    client.destroy();
    void voice.stop();
    window.removeEventListener("popstate", trackNavigation);
    window.removeEventListener("hashchange", trackNavigation);
    window.removeEventListener("keydown", onKeyDown);
    host.remove();
  };

  const header = el("header", {}, logo, title, select,
    el("button", { "aria-label": "Minimize", onclick: () => setOpen(false) }, "\u2013"),
    el("button", { "aria-label": "Close", onclick: () => setOpen(false) }, "\u00d7"));
  panel.append(header, voiceSelect, log, vstate, note, form, listening);
  fab.addEventListener("click", () => setOpen(panel.hidden));
  root.append(panel, fab);
  updateNote();
  return { trackPage, destroy };
}
