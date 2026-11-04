import { mountWidget } from "./widget.js";
import { resolveApiBase } from "./client.js";

(function boot() {
  const script = document.currentScript;
  if (!script) return;
  const publicKey = script.getAttribute("data-public-key");
  if (!publicKey || !/^wk_[A-Za-z0-9_-]{32,60}$/.test(publicKey)) return;
  const apiBase = resolveApiBase(script.src, script.getAttribute("data-api-base"), location.origin);
  const start = () => mountWidget({ publicKey, apiBase });
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
