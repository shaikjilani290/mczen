// McZEN widget API client. Pure (fetch injected) so it can be unit-tested without a DOM.
// The session token is kept in memory only and is sent in the Authorization header, never in a URL.

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

export function createWidgetClient({ apiBase, publicKey, fetchImpl = (...args) => fetch(...args) }) {
  let token = null;
  let hasConversation = false;
  let language;

  async function call(path, body, auth) {
    let response;
    try {
      response = await fetchImpl(`${apiBase}/api/widget/public${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body),
        credentials: "omit",
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

  async function start(preferredLanguage) {
    language = preferredLanguage;
    const result = await call("/session", { publicKey, ...(preferredLanguage ? { language: preferredLanguage } : {}) });
    token = result.sessionToken;
    hasConversation = false;
    return result.config;
  }

  async function attempt(body) {
    const result = await call("/message", body, token);
    token = result.sessionToken;
    hasConversation = true;
    return { success: result.success, answer: result.answer, sources: result.sources || [] };
  }

  async function send(message, selectedLanguage) {
    if (!token) await start(language);
    const body = { message, ...(selectedLanguage ? { language: selectedLanguage } : {}) };
    try {
      return await attempt(body);
    } catch (error) {
      // An expired session before the first turn can be replaced transparently; a mid-conversation expiry cannot.
      if (error.code === "expired" && !hasConversation) {
        await start(language);
        return attempt(body);
      }
      throw error;
    }
  }

  async function voiceTicket() {
    if (!token) await start(language);
    const result = await call("/voice-ticket", {}, token);
    if (typeof result.ticket !== "string") throw new WidgetError("failed", MESSAGES.failed);
    if (result.sessionToken) token = result.sessionToken;
    hasConversation = true;
    return { ticket: result.ticket, voice: result.voice || null };
  }
  return { start, send, voiceTicket, hasSession: () => token !== null };
}
