const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export class VoiceApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", token, body, query } = {}) {
  const url = new URL(`${API}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new VoiceApiError("Cannot reach McZEN. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.message) ? data.message.join(", ") : data.message;
    throw new VoiceApiError(detail || `Request failed (${response.status}).`, response.status);
  }
  return data;
}

export const voiceApi = {
  login: (email, password) =>
    request("/api/auth/login", { method: "POST", body: { email, password } }),
  activateTenant: (loginToken, tenantId) =>
    request(`/api/auth/tenants/${encodeURIComponent(tenantId)}/activate`, {
      method: "POST",
      token: loginToken,
      body: {},
    }),
  signOut: (token) =>
    request("/api/auth/logout", { method: "POST", token, body: {} }),
  assistants: (token) =>
    request("/api/assistants", { token }),
  conversations: (token) =>
    request("/api/conversations", {
      token,
      query: { page: 1, pageSize: 50, sortBy: "updatedAt", sortOrder: "desc" },
    }),
  createConversation: (token, assistantId, language) =>
    request("/api/conversations", {
      method: "POST",
      token,
      body: {
        assistantId,
        channel: "voice",
        language: language === "auto" ? "en" : language,
        title: "New conversation",
      },
    }),
  transcript: (token, conversationId) =>
    request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      token,
      query: { limit: 100 },
    }),
  ask: (token, question, conversationId) =>
    request("/api/agent/ask", {
      method: "POST",
      token,
      body: { question, conversationId },
    }),
};
