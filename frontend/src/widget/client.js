// McZEN widget API client. Pure (fetch injected) so it can be unit-tested without a DOM.
// The session token is kept in memory only and is sent in the Authorization header, never in a URL.
import { captureProductContext } from "./product-context.js";

export class WidgetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MESSAGES = {
  unavailable: "The assistant is not available on this site right now.",
  network: "Cannot reach the assistant. Check your connection and try again.",
  rate: "Too many messages. Please wait a moment and try again.",
  expired: "The conversation expired. Please try again.",
  failed: "Something went wrong. Please try again.",
};

export function resolveApiBase(scriptSrc, override, pageOrigin) {
  if (override) return override.replace(/\/$/, "");
  try { return new URL(scriptSrc, pageOrigin).origin; } catch { return pageOrigin; }
}

export function createWidgetClient({
  apiBase,
  publicKey,
  assistantId,
  integration = false,
  cartAdapter = null,
  onCartError = () => {},
  fetchImpl = (...args) => fetch(...args),
  productContext = captureProductContext,
}) {
  let token = null;
  let hasConversation = false;
  let language;
  const endpoint = integration ? "/api/website-integrations" : "/api/widget/public";
  let cartTimer = null;
  let cartPoll = null;
  let cartAbort = null;
  let textRequests = 0;
  let voiceActive = false;
  let destroyed = false;
  const completedActions = new Map();
  let lastCartError = null;
  let lastProductContext = null;
  let contextObserver = null;
  let contextTimer = null;
  let contextSync = null;

  async function syncProductContext(signal) {
    while (contextSync) await contextSync;
    const pending = publishProductContext(signal);
    contextSync = pending;
    try { await pending; } finally { contextSync = null; }
  }

  async function publishProductContext(signal) {
    if (destroyed || !integration || !token) return;
    const sessionToken = token;
    const context = await productContext();
    if (destroyed || token !== sessionToken || !context) return;
    const serialized = JSON.stringify(context);
    if (serialized === lastProductContext) return;
    try {
      await call("/product-context", context, sessionToken, signal);
    } catch (error) {
      if (error instanceof WidgetError && ["network", "failed"].includes(error.code)) {
        throw new WidgetError(error.code, "Product page context could not be synchronized. Reload the page and try again.");
      }
      throw error;
    }
    if (!destroyed && token === sessionToken) lastProductContext = serialized;
  }

  const needsCart = () => !destroyed && !!token && integration && !!cartAdapter &&
    (textRequests > 0 || voiceActive);

  function stopIdleCartPolling() {
    if (needsCart()) return;
    clearTimeout(cartTimer);
    cartTimer = null;
    cartAbort?.abort();
  }

  function pollCart() {
    if (cartPoll) return cartPoll;
    if (!needsCart()) return Promise.resolve();
    clearTimeout(cartTimer);
    cartTimer = null;
    cartPoll = performCartPoll().finally(() => {
      cartPoll = null;
      if (needsCart()) cartTimer = setTimeout(pollCart, 750);
    });
    return cartPoll;
  }

  async function performCartPoll() {
    const abort = new AbortController();
    cartAbort = abort;
    const timeout = setTimeout(() => abort.abort(), 5000);
    try {
      const selectedProductId = cartAdapter.selectedProductId?.();
      const result = await call("/cart/poll", selectedProductId ? { selectedProductId } : {}, token, abort.signal);
      clearTimeout(timeout);
      cartAbort = null;
      if (destroyed) return;
      if (result.action) {
        const action = result.action;
        if (!/^[a-f0-9]{64}$/.test(action.id) || !["add_to_cart", "get_cart", "update_cart_item", "remove_cart_item", "open_cart"].includes(action.operation)) {
          throw new WidgetError("failed", "The merchant received an invalid cart operation.");
        }
        let acknowledgement = completedActions.get(action.id);
        if (!acknowledgement) {
          try {
            const cart = await cartAdapter.execute(action);
            if (action.operation === "open_cart") {
              if (typeof cartAdapter.openCart !== "function") throw new WidgetError("failed", "The merchant cart page cannot be opened by this adapter.");
              await cartAdapter.openCart();
            }
            acknowledgement = { id: action.id, success: true, cart };
          } catch (error) {
            acknowledgement = { id: action.id, success: false, error: (error?.message || "The merchant cart operation failed.").slice(0, 300) };
          }
          completedActions.set(action.id, acknowledgement);
          if (completedActions.size > 100) completedActions.delete(completedActions.keys().next().value);
        }
        await call("/cart/result", acknowledgement, token, AbortSignal.timeout(5000));
      }
      lastCartError = null;
    } catch (error) {
      if (abort.signal.aborted && !needsCart()) return;
      if (lastCartError !== error.message) onCartError(error.message);
      lastCartError = error.message;
    } finally {
      clearTimeout(timeout);
      if (cartAbort === abort) cartAbort = null;
    }
  }

  async function call(path, body, auth, signal) {
    let response;
    try {
      response = await fetchImpl(`${apiBase}${endpoint}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + auth } : {}) },
        body: JSON.stringify(body),
        credentials: "omit",
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new WidgetError("network", MESSAGES.network);
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    if (response.status === 429) throw new WidgetError("rate", MESSAGES.rate);
    if (response.status === 401) throw new WidgetError("expired", MESSAGES.expired);
    if (response.status === 403) throw new WidgetError("unavailable", MESSAGES.unavailable);
    throw new WidgetError("failed", MESSAGES.failed);
  }

  async function start(preferredLanguage, signal) {
    language = preferredLanguage;
    const result = await call(integration ? "/connect" : "/session", {
      publicKey,
      ...(integration && assistantId ? { assistantId } : {}),
      ...(preferredLanguage ? { language: preferredLanguage } : {}),
    }, undefined, signal);
    token = result.sessionToken;
    lastProductContext = null;
    hasConversation = false;
    await syncProductContext(signal);
    if (!destroyed && integration && !contextObserver && globalThis.MutationObserver && globalThis.document?.body) {
      contextObserver = new MutationObserver(() => {
        clearTimeout(contextTimer);
        contextTimer = setTimeout(() => {
          syncProductContext(AbortSignal.timeout(5000)).catch(error => onCartError(error.message));
        }, 150);
      });
      contextObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    return result.config;
  }

  async function attempt(body) {
    const result = await call("/message", body, token);
    token = result.sessionToken;
    hasConversation = true;
    return {
      success: result.success,
      answer: result.answer,
      sources: result.sources || [],
      products: Array.isArray(result.products) ? result.products.slice(0, 5) : [],
    };
  }

  async function send(message, selectedLanguage) {
    if (!token) await start(language);
    const body = { message, ...(selectedLanguage ? { language: selectedLanguage } : {}),
      ...(integration && cartAdapter ? { requestId: crypto.randomUUID() } : {}) };
    textRequests++;
    try {
      await syncProductContext(AbortSignal.timeout(5000));
      await pollCart();
      return await attempt(body);
    } catch (error) {
      // An expired session before the first turn can be replaced transparently; a mid-conversation expiry cannot.
      if (error.code === "expired" && !hasConversation) {
        await start(language);
        await pollCart();
        return await attempt(body);
      }
      throw error;
    } finally {
      textRequests--;
      stopIdleCartPolling();
    }
  }

  async function voiceTicket({ signal } = {}) {
    if (!token) await start(language, signal);
    await syncProductContext(signal);
    await pollCart();
    const result = await call("/voice-ticket", {}, token, signal);
    if (typeof result.ticket !== "string") throw new WidgetError("failed", MESSAGES.failed);
    if (result.sessionToken) token = result.sessionToken;
    hasConversation = true;
    return { ticket: result.ticket, voice: result.voice || null };
  }

  async function trackPageView() {
    if (!integration || !token) return;
    let response;
    try {
      response = await fetchImpl(`${apiBase}/api/website-ingestion/page-view`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ pageUrl: location.href, title: document.title, referrer: document.referrer || null }),
        credentials: "omit",
      });
    } catch {
      throw new WidgetError("network", MESSAGES.network);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new WidgetError("unavailable", MESSAGES.unavailable);
      throw new WidgetError("failed", MESSAGES.failed);
    }
  }

  return {
    start, send, voiceTicket, trackPageView, hasSession: () => token !== null,
    setVoiceActive(active) {
      if (voiceActive === active) return cartPoll ?? Promise.resolve();
      voiceActive = active;
      if (needsCart()) return pollCart();
      stopIdleCartPolling();
      return Promise.resolve();
    },
    destroy() {
      destroyed = true;
      clearTimeout(cartTimer);
      cartTimer = null;
      cartAbort?.abort();
      clearTimeout(contextTimer);
      contextObserver?.disconnect();
    },
  };
}
