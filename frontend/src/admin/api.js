// Admin API client (Phase 6E). The access token lives in memory only (never localStorage).
// The tenant is derived by the server from the token; no tenant id is ever sent in a body or query.

const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी (Hindi)" },
  { code: "te", label: "తెలుగు (Telugu)" },
];
export const languageLabel = (code) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const state = { token: null, onUnauthorized: () => {} };
export const setToken = (token) => { state.token = token; };
export const setUnauthorizedHandler = (fn) => { state.onUnauthorized = fn; };

function fail(response, data) {
  if (response.status === 401) state.onUnauthorized();
  const detail = Array.isArray(data.message) ? data.message.join(", ") : data.message;
  return new ApiError(detail || `Request failed (${response.status})`, response.status);
}

export async function request(method, path, { body, query, token } = {}) {
  const url = new URL(`${API}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const bearer = token || state.token;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw fail(response, data);
  return data;
}

// XMLHttpRequest is used for uploads because fetch cannot report upload progress.
function upload(method, path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API}${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${state.token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError("Upload failed. Check your connection and try again.", 0));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) state.onUnauthorized();
      const detail = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      reject(new ApiError(detail || `Upload failed (${xhr.status})`, xhr.status));
    };
    xhr.send(formData);
  });
}

export const auth = {
  signIn: (email, password) => request("POST", "/api/auth/login", { body: { email, password } }),
  activate: (loginToken, tenantId) =>
    request("POST", `/api/auth/tenants/${encodeURIComponent(tenantId)}/activate`, { body: {}, token: loginToken }),
  async signOut() {
    try { await request("POST", "/api/auth/logout", { body: {} }); } catch { /* session dropped locally either way */ }
  },
};

const K = "/api/knowledge";

export const knowledge = {
  dashboard: () => request("GET", `${K}/dashboard`),
  search: (query) => request("GET", `${K}/search`, { query }),
  categories: () => request("GET", `${K}/categories`),
  createCategory: (body) => request("POST", `${K}/categories`, { body }),
  updateCategory: (id, body) => request("PATCH", `${K}/categories/${id}`, { body }),
  deleteCategory: (id) => request("DELETE", `${K}/categories/${id}`),
  articles: (query) => request("GET", `${K}/articles`, { query }),
  article: (id) => request("GET", `${K}/articles/${id}`),
  createArticle: (body) => request("POST", `${K}/articles`, { body }),
  updateArticle: (id, body) => request("PATCH", `${K}/articles/${id}`, { body }),
  archiveArticle: (id) => request("POST", `${K}/articles/${id}/archive`, { body: {} }),
  documents: (query) => request("GET", `${K}/documents`, { query }),
  updateDocument: (id, body) => request("PATCH", `${K}/documents/${id}`, { body }),
  reprocessDocument: (id) => request("POST", `${K}/documents/${id}/reprocess`, { body: {} }),
  archiveDocument: (id) => request("POST", `${K}/documents/${id}/archive`, { body: {} }),
  uploadDocument: (fields, file, onProgress) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
    form.append("file", file);
    return upload("POST", `${K}/documents`, form, onProgress);
  },
  replaceDocumentFile: (id, file, onProgress) => {
    const form = new FormData();
    form.append("file", file);
    return upload("PUT", `${K}/documents/${id}/file`, form, onProgress);
  },
  async downloadDocument(id, filename) {
    const response = await fetch(`${API}${K}/documents/${id}/download`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) throw fail(response, await response.json().catch(() => ({})));
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
};
