import { useState } from "react";
import { assistants, websiteIntegrations } from "../api2.js";
import { useLoad } from "../screens.jsx";

const Banner = ({ error }) => error ? <div className="ad-error" role="alert">{error}</div> : null;
const timestamp = (value) => value ? new Date(value).toLocaleString() : "—";
const statusClass = (value) => value === "active" || value === "completed" ? "ad-pill active" : "ad-pill";

function useAction() {
  const [state, setState] = useState({ busy: false, error: "", success: "" });
  const run = async (fn, success = "Saved.") => {
    setState({ busy: true, error: "", success: "" });
    try {
      const result = await fn();
      setState({ busy: false, error: "", success });
      return result;
    } catch (error) {
      setState({ busy: false, error: error.message, success: "" });
      return undefined;
    }
  };
  return [state, run, setState];
}

function IntegrationDetails({ item, onSecret, onChanged }) {
  const [action, run, setAction] = useAction();
  const [expanded, setExpanded] = useState(false);
  const pages = useLoad(
    () => expanded ? websiteIntegrations.pages(item.id, { page: 1, pageSize: 10 }) : Promise.resolve([]),
    [item.id, expanded],
  );
  const products = useLoad(
    () => expanded ? websiteIntegrations.products(item.id, { page: 1, pageSize: 10 }) : Promise.resolve([]),
    [item.id, expanded],
  );
  const sdkBase = window.location.origin;
  const localIngestion = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(item.domain).hostname.replace(/\.$/, ""));
  const snippet = `<script src="${sdkBase}/mczen-sdk.js"></script>\n<script>\n  McZEN.init({\n    integrationKey: "${item.publicKey}",\n    assistantId: "${item.assistantId}"\n  });\n</script>`;

  async function rotate() {
    if (!window.confirm(`Rotate credentials for ${item.name}? The current public key and ingestion key will stop working.`)) return;
    const keys = await run(() => websiteIntegrations.rotateKeys(item.id), "Credentials rotated. Save the one-time ingestion key now.");
    if (keys) {
      onSecret({ id: item.id, name: item.name, publicKey: keys.publicKey, ingestionKey: keys.ingestionKey });
      onChanged();
    }
  }
  async function revoke() {
    if (!window.confirm(`Revoke ${item.name}? Its SDK and ingestion credentials will stop working immediately.`)) return;
    const result = await run(() => websiteIntegrations.revoke(item.id), "Integration revoked.");
    if (result) onChanged();
  }
  async function sync() {
    const result = await run(() => websiteIntegrations.sync(item.id), "Synchronization started.");
    if (result) onChanged();
  }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setAction({ busy: false, error: "", success: "Copied to clipboard." });
    } catch {
      setAction({ busy: false, error: "Clipboard access is unavailable in this browser.", success: "" });
    }
  }

  return (
    <article className="ad-box">
      <div className="ad-toolbar" style={{ justifyContent: "space-between" }}>
        <div>
          <h3>{item.name}</h3>
          <p className="ad-muted">{item.domain} · Assistant: {item.assistantName}</p>
        </div>
        <span className={statusClass(item.status)}>{item.status}</span>
      </div>
      <div className="ad-cards">
        <div className="ad-card"><b>{item.pageCount ?? item.pagesDiscovered}</b><span>Pages discovered</span></div>
        <div className="ad-card"><b>{item.productCount ?? item.productsImported}</b><span>Products imported</span></div>
        <div className="ad-card"><b>{item.knowledgeIndexed}</b><span>Knowledge indexed</span></div>
        <div className="ad-card"><b>{item.syncStatus}</b><span>Sync status</span></div>
      </div>
      <p className="ad-muted">Last synchronization: {timestamp(item.lastSyncAt)}</p>
      {localIngestion && (
        <p className="ad-muted" role="status">
          Local development: use the merchant server-only adapter, not the crawler.
          Enable NODE_ENV=development and MCZEN_ALLOW_LOCAL_INGESTION=1 in both server processes,
          then run <code>npm run mczen:sync:local:dry-run</code> and <code>npm run mczen:sync:local</code> in mcgen-rea.
          Refresh this list after importing. CLI output shows accepted counts and sync errors.
        </p>
      )}
      {Array.isArray(item.errors) && item.errors.length > 0 && (
        <div className="ad-error" role="status">
          <b>Synchronization messages</b>
          <ul>{item.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul>
        </div>
      )}
      <details>
        <summary>Installation instructions</summary>
        <p className="ad-muted">This public site key is restricted to the registered domain. The server ingestion key is separate and must never be embedded in browser JavaScript.</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 12, borderRadius: 8, background: "var(--line)" }}><code>{snippet}</code></pre>
        <button type="button" onClick={() => void copy(snippet)}>Copy SDK snippet</button>
      </details>
      <div className="ad-actions">
        <button type="button" className="ad-primary" disabled={localIngestion || action.busy || item.status !== "active"} onClick={() => void sync()}>
          {localIngestion ? "Use local ingestion CLI" : action.busy ? "Working…" : "Start sync"}
        </button>
        <button type="button" disabled={action.busy} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Hide imported data" : "View pages and products"}
        </button>
        <button type="button" disabled={action.busy} onClick={() => void rotate()}>Rotate keys</button>
        {item.status === "active" && <button type="button" disabled={action.busy} onClick={() => void revoke()}>Revoke</button>}
      </div>
      {action.success && <div className="ad-ok" role="status">{action.success}</div>}
      <Banner error={action.error} />
      {expanded && (
        <div className="ad-grid2">
          <section><h4>Imported pages</h4>{pages.loading ? <p className="ad-muted">Loading…</p> : <ul>{(pages.data || []).map((page) => <li key={page.url}><a href={page.url} target="_blank" rel="noreferrer">{page.title || page.url}</a></li>)}</ul>}<Banner error={pages.error} /></section>
          <section><h4>Imported products</h4>{products.loading ? <p className="ad-muted">Loading…</p> : <ul>{(products.data || []).map((product) => <li key={product.externalProductId}>{product.name} · {product.availability}{product.price != null ? ` · ${product.currency || ""} ${product.price}` : ""}</li>)}</ul>}<Banner error={products.error} /></section>
        </div>
      )}
    </article>
  );
}

export function WebsiteIntegrations() {
  const integrationList = useLoad(() => websiteIntegrations.list(), []);
  const assistantList = useLoad(() => assistants.list(), []);
  const [form, setForm] = useState({ name: "", domain: "", assistantId: "" });
  const [secret, setSecret] = useState(null);
  const [secretCopyError, setSecretCopyError] = useState("");
  const [createState, create] = useAction();

  const activeAssistants = (assistantList.data?.assistants || []).filter((assistant) => assistant.status === "active");

  async function submit(event) {
    event.preventDefault();
    const result = await create(() => websiteIntegrations.create(form), "Website registered.");
    if (result) {
      setSecret({
        id: result.integration.id, name: result.integration.name,
        publicKey: result.integration.publicKey, ingestionKey: result.ingestionKey,
      });
      setForm({ name: "", domain: "", assistantId: "" });
      integrationList.reload();
    }
  }

  async function copySecret() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(secret.ingestionKey);
      setSecretCopyError("");
    } catch {
      setSecretCopyError("Clipboard access is unavailable in this browser.");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2>Website Integrations</h2>
        <p className="ad-muted">Connect a website to an assistant, ingest pages and products, and keep the imported content in McZEN’s existing knowledge system.</p>
      </div>
      <form className="ad-form ad-box" onSubmit={submit}>
        <h3>Register a website</h3>
        <div className="ad-row">
          <label>Website name<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Website domain<input required maxLength={253} placeholder="https://shop.example.com" value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} /></label>
          <label>Assistant
            <select required value={form.assistantId} onChange={(event) => setForm({ ...form, assistantId: event.target.value })}>
              <option value="">Select an active assistant…</option>
              {activeAssistants.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}
            </select>
          </label>
        </div>
        <Banner error={assistantList.error} />
        <Banner error={createState.error} />
        {createState.success && <div className="ad-ok" role="status">{createState.success}</div>}
        <div className="ad-actions">
          <button className="ad-primary" disabled={createState.busy || activeAssistants.length === 0}>
            {createState.busy ? "Registering…" : "Register website"}
          </button>
        </div>
      </form>

      {secret && (
        <section className="ad-box" aria-labelledby="integration-secret-heading">
          <h3 id="integration-secret-heading">Save credentials for {secret.name}</h3>
          <p className="ad-muted">The server ingestion key is shown once. Copy it now and store it in the external website’s server-side secret manager. Never expose it in browser JavaScript.</p>
          <label>Public site key (safe for the registered website)<textarea readOnly rows={2} value={secret.publicKey} /></label>
          <label>Server-side ingestion key (one-time secret)<textarea readOnly rows={2} value={secret.ingestionKey} /></label>
          <div className="ad-actions">
            <button type="button" onClick={() => void copySecret()}>Copy ingestion key</button>
            <button type="button" onClick={() => setSecret(null)}>Dismiss</button>
          </div>
          <Banner error={secretCopyError} />
        </section>
      )}

      <section>
        <div className="ad-toolbar" style={{ justifyContent: "space-between" }}>
          <h3>Registered websites</h3>
          <button type="button" onClick={integrationList.reload}>Refresh</button>
        </div>
        {integrationList.loading && <p className="ad-muted">Loading integrations…</p>}
        <Banner error={integrationList.error} />
        {!integrationList.loading && !integrationList.error && (integrationList.data || []).length === 0 && (
          <p className="ad-muted">No websites connected yet.</p>
        )}
        <div className="space-y-4">
          {(integrationList.data || []).map((item) => (
            <IntegrationDetails key={item.id} item={item} onSecret={setSecret} onChanged={integrationList.reload} />
          ))}
        </div>
      </section>
    </div>
  );
}
