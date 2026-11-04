import { request } from "./api.js";

const T = (name) => `/api/tools/${encodeURIComponent(name)}`;

export const assistants = {
  list: () => request("GET", "/api/assistants"),
  create: (body) => request("POST", "/api/assistants", { body }),
  get: (id) => request("GET", `/api/assistants/${encodeURIComponent(id)}`),
  update: (id, sections) => request("PATCH", `/api/assistants/${encodeURIComponent(id)}`, { body: sections }),
  setInstructions: (id, body) => request("PUT", `/api/assistants/${encodeURIComponent(id)}/instructions`, { body }),
};

export const widget = {
  settings: () => request("GET", "/api/widget/settings"),
  update: (body) => request("PATCH", "/api/widget/settings", { body }),
  rotateKey: () => request("POST", "/api/widget/settings/rotate-key", { body: {} }),
  analytics: (query) => request("GET", "/api/widget/analytics", { query }),
};

export const tools = {
  list: () => request("GET", "/api/tools"),
  update: (name, body) => request("PATCH", `${T(name)}/tenant-config`, { body }),
  setAssistant: (name, assistantId, enabled) =>
    request("PUT", `${T(name)}/assistants/${encodeURIComponent(assistantId)}`, { body: { enabled } }),
  secret: (name) => request("GET", `${T(name)}/tenant-secret`),
  setSecret: (name, value) => request("PUT", `${T(name)}/tenant-secret`, { body: { value } }),
  revokeSecret: (name) => request("DELETE", `${T(name)}/tenant-secret`),
};

export const conversations = {
  list: (query) => request("GET", "/api/conversations", { query }),
  messages: (id) => request("GET", `/api/conversations/${encodeURIComponent(id)}/messages`, { query: { limit: 200 } }),
  toolCalls: (id, messageId) =>
    request("GET", `/api/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/tool-calls`),
};

export const voice = { capabilities: () => request("GET", "/api/voice/capabilities") };

export const platform = {
  overview: () => request("GET", "/api/platform/overview"),
  tenants: (query) => request("GET", "/api/platform/tenants", { query }),
  setStatus: (id, status) => request("PATCH", `/api/platform/tenants/${encodeURIComponent(id)}/status`, { body: { status } }),
};
