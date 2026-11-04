// Typed-by-convention client for the tenant assistant-configuration API (Phase 6D).
// The tenant is derived server-side from the access token; no tenant id is ever sent.
// Provider API keys are write-only: the API returns only `{ configured: boolean }`.

const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function request(accessToken, method, path, body) {
  const response = await fetch(`${API}/api/assistants${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

export const assistantApi = {
  options: (token) => request(token, "GET", "/options"),
  list: (token) => request(token, "GET", ""),
  create: (token, { name, description, systemPrompt }) =>
    request(token, "POST", "", { name, description, systemPrompt }),
  get: (token, id) => request(token, "GET", `/${id}`),
  // sections: { profile, language, voice, branding, preferences } — any subset.
  update: (token, id, sections) => request(token, "PATCH", `/${id}`, sections),
  instructionHistory: (token, id) => request(token, "GET", `/${id}/instructions`),
  setInstructions: (token, id, { systemPrompt, guardrailNotes }) =>
    request(token, "PUT", `/${id}/instructions`, { systemPrompt, guardrailNotes }),
  setSecret: (token, id, kind, apiKey) => request(token, "PUT", `/${id}/secrets/${kind}`, { apiKey }),
  clearSecret: (token, id, kind) => request(token, "DELETE", `/${id}/secrets/${kind}`),
  audit: (token, id) => request(token, "GET", `/${id}/audit`),
};
