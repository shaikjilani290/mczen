import { useEffect, useState } from "react";
import { voiceLibrary } from "./api.js";
import { assistants, widget, tools, conversations, voice, platform } from "./api2.js";
import { useLoad } from "./screens.jsx";

// All values are rendered as plain text by React. Secrets are never fetched or displayed.

const Banner = ({ error }) => (error ? <div className="ad-error" role="alert">{error}</div> : null);
const Loading = () => <p className="ad-muted">Loading…</p>;
const fmt = (v) => (v ? new Date(v).toLocaleString() : "—");
const LANGS = { en: "English", hi: "हिन्दी", te: "తెలుగు" };

function useSave() {
  const [state, setState] = useState({ busy: false, error: "", ok: "" });
  const run = async (fn, okText = "Saved.") => {
    setState({ busy: true, error: "", ok: "" });
    try { const r = await fn(); setState({ busy: false, error: "", ok: okText }); return r; }
    catch (e) { setState({ busy: false, error: e.message, ok: "" }); return undefined; }
  };
  return [state, run];
}

const Status = ({ s }) => (
  <>{s.error && <Banner error={s.error} />}{s.ok && <div className="ad-ok" role="status">{s.ok}</div>}</>
);

const Bars = ({ rows, label, value }) => {
  const max = Math.max(1, ...rows.map(value));
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0", fontSize: 12 }}>
          <span style={{ width: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(r)}</span>
          <div style={{ flex: 1, background: "var(--line)", borderRadius: 4 }}>
            <div style={{ width: `${(value(r) / max) * 100}%`, background: "var(--brand-bright)", height: 10, borderRadius: 4 }} />
          </div>
          <b>{value(r)}</b>
        </div>
      ))}
      {rows.length === 0 && <p className="ad-muted">No data in this range.</p>}
    </div>
  );
};

export function Analytics() {
  const [range, setRange] = useState({ from: "", to: "" });
  const { loading, error, data } = useLoad(() => widget.analytics(range), [range.from, range.to]);
  const t = data?.totals;
  return (
    <div>
      <h2>Dashboard</h2>
      <div className="ad-toolbar">
        <label className="ad-muted">From<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="ad-muted">To<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
      </div>
      {loading && <Loading />}<Banner error={error} />
      {data && (
        <>
          <p className="ad-muted">{data.range.from} to {data.range.to} (UTC)</p>
          <div className="ad-cards">
            {[["Conversations", t.conversations], ["Messages", t.messages], ["Voice conversations", t.voiceConversations],
              ["Text conversations", t.textConversations], ["Widget conversations", t.widgetConversations],
              ["Active voice sessions", t.activeVoiceSessions], ["Knowledge articles", t.knowledgeArticles]]
              .map(([l, v]) => <div className="ad-card" key={l}><b>{v}</b><span>{l}</span></div>)}
          </div>
          <div className="ad-grid2">
            <div className="ad-box"><h3>Daily conversations</h3><Bars rows={data.dailyConversations} label={(r) => r.day} value={(r) => r.total} /></div>
            <div className="ad-box"><h3>Messages by modality</h3><Bars rows={data.messagesByModality} label={(r) => r.modality} value={(r) => r.total} /></div>
            <div className="ad-box"><h3>Language distribution</h3><Bars rows={data.languageDistribution} label={(r) => LANGS[r.language] || r.language} value={(r) => r.total} /></div>
            <div className="ad-box"><h3>Tool usage</h3><Bars rows={data.toolUsage} label={(r) => `${r.tool} (${r.outcome})`} value={(r) => r.total} /></div>
            <div className="ad-box"><h3>Assistant usage</h3><Bars rows={data.assistantUsage} label={(r) => r.name} value={(r) => r.conversations} /></div>
          </div>
        </>
      )}
    </div>
  );
}

function AssistantEditor({ id, onDone }) {
  const { loading, error, data } = useLoad(() => assistants.get(id), [id]);
  const [form, setForm] = useState(null);
  const [save, run] = useSave();
  if (loading) return <Loading />;
  if (error) return <Banner error={error} />;
  const f = form || {
    name: data.profile.name, greetingMessage: data.profile.greetingMessage || "", personality: data.profile.personality || "",
    status: data.profile.status, enabled: data.language.enabled, defaultLanguage: data.language.defaultLanguage,
    voiceGender: data.voice?.voiceGender || "female", speechRate: data.voice?.speechRate ?? 1, systemPrompt: data.instructions?.systemPrompt || "",
  };
  const set = (patch) => setForm({ ...f, ...patch });
  const toggleLang = (l) => set({ enabled: f.enabled.includes(l) ? f.enabled.filter((x) => x !== l) : [...f.enabled, l] });

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await assistants.update(id, {
        profile: { name: f.name, greetingMessage: f.greetingMessage || null, personality: f.personality || null, status: f.status },
        language: { defaultLanguage: f.defaultLanguage, enabled: f.enabled },
        ...(data.voice ? { voice: { voiceGender: f.voiceGender, speechRate: Number(f.speechRate) } } : {}),
      });
      if (f.systemPrompt && f.systemPrompt !== data.instructions?.systemPrompt) await assistants.setInstructions(id, { systemPrompt: f.systemPrompt });
    });
  };

  return (
    <form className="ad-form ad-box" onSubmit={submit}>
      <h3>{data.profile.name}{data.isDefault ? " (default)" : ""}</h3>
      <div className="ad-row">
        <label>Name<input required value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label>Status
          <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
            {["draft", "active", "paused", "archived"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <label>Greeting message<textarea rows={2} value={f.greetingMessage} onChange={(e) => set({ greetingMessage: e.target.value })} /></label>
      <label>Personality<textarea rows={2} value={f.personality} onChange={(e) => set({ personality: e.target.value })} /></label>
      <label>System instructions<textarea rows={5} value={f.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} /></label>
      <div className="ad-row">
        <div>
          <span className="ad-muted">Supported languages</span>
          <div className="ad-actions">
            {Object.entries(LANGS).map(([l, n]) => (
              <label key={l} style={{ flexDirection: "row", alignItems: "center" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={f.enabled.includes(l)} onChange={() => toggleLang(l)} />{n}
              </label>
            ))}
          </div>
        </div>
        <label>Default language
          <select value={f.defaultLanguage} onChange={(e) => set({ defaultLanguage: e.target.value })}>
            {f.enabled.map((l) => <option key={l} value={l}>{LANGS[l]}</option>)}
          </select>
        </label>
      </div>
      {data.voice && (
        <div className="ad-row">
          <label>Voice
            <select value={f.voiceGender} onChange={(e) => set({ voiceGender: e.target.value })}>
              {["female", "male", "neutral"].map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label>Speech speed<input type="number" step="0.1" min="0.5" max="2" value={f.speechRate} onChange={(e) => set({ speechRate: e.target.value })} /></label>
        </div>
      )}
      <Status s={save} />
      <div className="ad-actions">
        <button className="ad-primary" disabled={save.busy || f.enabled.length === 0 || !f.enabled.includes(f.defaultLanguage)}>Save</button>
        <button type="button" onClick={onDone}>Back</button>
      </div>
    </form>
  );
}

export function Assistants() {
  const [edit, setEdit] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", systemPrompt: "" });
  const [save, run] = useSave();
  const { loading, error, data } = useLoad(() => assistants.list(), [edit]);
  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const assistant = await assistants.create({
        name: form.name.trim(),
        description: form.description.trim() || null,
        ...(form.systemPrompt.trim() ? { systemPrompt: form.systemPrompt.trim() } : {}),
      });
      setCreating(false);
      setForm({ name: "", description: "", systemPrompt: "" });
      setEdit(assistant.id);
    }, "Assistant created.");
  };
  if (edit) return <AssistantEditor id={edit} onDone={() => setEdit(null)} />;
  return (
    <div>
      <h2>Assistants</h2>
      <div className="ad-actions" style={{ marginBottom: 12 }}>
        <button className="ad-primary" onClick={() => setCreating(true)}>Create assistant</button>
      </div>
      {creating && (
        <form className="ad-form ad-box" onSubmit={create}>
          <h3>Create assistant</h3>
          <label>Name<input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Description<textarea maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>System instructions<textarea rows={5} maxLength={16000} value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} /></label>
          <Status s={save} />
          <div className="ad-actions">
            <button className="ad-primary" disabled={save.busy || !form.name.trim()}>{save.busy ? "Creating..." : "Create"}</button>
            <button type="button" disabled={save.busy} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}
      {loading && <Loading />}<Banner error={error} />
      {!loading && !error && data?.assistants?.length === 0 && (
        <p className="ad-muted">No assistants yet. Create your first assistant, then set its status to active in the editor.</p>
      )}
      <div className="ad-table-wrap"><table className="ad-table"><tbody>
        {(data?.assistants || []).map((a) => (
          <tr key={a.id}>
            <td>{a.name} {a.isDefault && <span className="ad-pill">default</span>}</td>
            <td><span className={`ad-pill ${a.status}`}>{a.status}</span></td>
            <td>{fmt(a.updatedAt)}</td>
            <td><button className="ad-quiet" onClick={() => setEdit(a.id)}>Edit</button></td>
          </tr>
        ))}
      </tbody></table></div>
      <p className="ad-muted">Default-assistant selection is not exposed by the assistant API yet.</p>
    </div>
  );
}

function WidgetPreview({ f }) {
  const dark = f.theme === "dark";
  return (
    <div style={{ background: dark ? "#1b1626" : "#fff", color: dark ? "#f4f0fa" : "#1c1726", borderRadius: 12, overflow: "hidden", border: "1px solid #ffffff22", maxWidth: 300 }}>
      <div style={{ background: f.primaryColor, color: "#fff", padding: 10, fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
        {f.logoUrl?.startsWith("https://") && <img src={f.logoUrl} alt="" width={24} height={24} style={{ borderRadius: "50%" }} />}{f.name || "Assistant"}
      </div>
      <div style={{ padding: 12, fontSize: 13, minHeight: 70 }}>{f.welcomeMessage || "Welcome!"}<br /><br />{f.initialGreeting}</div>
      <div style={{ display: "flex", justifyContent: f.position === "bottom-left" ? "flex-start" : "flex-end", padding: 10 }}>
        <span style={{ background: f.primaryColor, color: "#fff", padding: f.buttonStyle === "pill" ? "10px 18px" : 12, borderRadius: { round: "50%", pill: 999, square: 12 }[f.buttonStyle] }}>💬{f.buttonStyle === "pill" ? " Chat" : ""}</span>
      </div>
    </div>
  );
}

export function WidgetSettings() {
  const { loading, error, data, reload } = useLoad(() => widget.settings(), []);
  const [form, setForm] = useState(null);
  const [save, run] = useSave();
  if (loading && !data) return <Loading />;
  if (error) return <Banner error={error} />;
  const f = form || { ...data, allowedOrigins: data.allowedOrigins.join("\n") };
  const set = (patch) => setForm({ ...f, ...patch });
  const origin = window.location.origin;
  const snippet = `<script src="${origin}/widget.js" data-public-key="${data.publicKey}" defer></script>`;

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const next = await widget.update({
        enabled: f.enabled, name: f.name, logoUrl: f.logoUrl || null, primaryColor: f.primaryColor, theme: f.theme,
        position: f.position, buttonStyle: f.buttonStyle, welcomeMessage: f.welcomeMessage || null, initialGreeting: f.initialGreeting || null,
        allowedOrigins: f.allowedOrigins.split(/\s+/).filter(Boolean),
      });
      setForm(null); reload(); return next;
    });
  };
  const rotate = () => {
    if (!window.confirm("Rotate the public key? Embedded widgets using the old key will stop working.")) return;
    run(async () => { await widget.rotateKey(); setForm(null); reload(); }, "Key rotated. Update your embed snippet.");
  };

  return (
    <div>
      <h2>Widget</h2>
      <div className="ad-grid2">
        <form className="ad-form ad-box" onSubmit={submit}>
          <label style={{ flexDirection: "row", alignItems: "center" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Widget enabled
          </label>
          <label>Widget name<input value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>Logo URL (https)<input value={f.logoUrl || ""} onChange={(e) => set({ logoUrl: e.target.value })} /></label>
          <div className="ad-row">
            <label>Primary color<input type="color" value={f.primaryColor} onChange={(e) => set({ primaryColor: e.target.value })} /></label>
            <label>Theme<select value={f.theme} onChange={(e) => set({ theme: e.target.value })}>{["light", "dark", "auto"].map((v) => <option key={v}>{v}</option>)}</select></label>
            <label>Position<select value={f.position} onChange={(e) => set({ position: e.target.value })}>{["bottom-right", "bottom-left"].map((v) => <option key={v}>{v}</option>)}</select></label>
            <label>Button<select value={f.buttonStyle} onChange={(e) => set({ buttonStyle: e.target.value })}>{["round", "pill", "square"].map((v) => <option key={v}>{v}</option>)}</select></label>
          </div>
          <label>Welcome message<textarea rows={2} value={f.welcomeMessage || ""} onChange={(e) => set({ welcomeMessage: e.target.value })} /></label>
          <label>Initial greeting (overrides assistant greeting)<textarea rows={2} value={f.initialGreeting || ""} onChange={(e) => set({ initialGreeting: e.target.value })} /></label>
          <label>Allowed website origins (one per line, e.g. https://example.com)
            <textarea rows={4} value={f.allowedOrigins} onChange={(e) => set({ allowedOrigins: e.target.value })} />
          </label>
          <Status s={save} />
          <button className="ad-primary" disabled={save.busy}>Save</button>
        </form>
        <div>
          <div className="ad-box"><h3>Preview</h3><WidgetPreview f={f} /></div>
          <div className="ad-box">
            <h3>Install</h3>
            <p className="ad-muted">The public key identifies your workspace only; it grants no admin access. The widget works only on allowed origins and only while enabled.</p>
            <textarea readOnly rows={3} value={snippet} onFocus={(e) => e.target.select()} />
            <div className="ad-actions" style={{ marginTop: 8 }}><button type="button" onClick={rotate} disabled={save.busy}>Rotate key</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolRow({ tool, assistantList, reload }) {
  const [save, run] = useSave();
  const [secret, setSecret] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <div className="ad-box">
      <div className="ad-actions" style={{ justifyContent: "space-between" }}>
        <div><b>{tool.displayName}</b> <span className="ad-pill">{tool.category}</span><div className="ad-muted">{tool.description}</div></div>
        <button disabled={save.busy} onClick={() => run(async () => { await tools.update(tool.name, { enabled: !tool.enabled }); reload(); })}>
          {tool.enabled ? "Disable" : "Enable"}
        </button>
      </div>
      <p className="ad-muted">Requires: {tool.requiredPermissions.join(", ") || "none"} · Secret: {tool.secret.configured ? `configured (rotated ${fmt(tool.secret.lastRotatedAt)})` : "not configured"}</p>
      <Status s={save} />
      <div className="ad-actions">
        <button className="ad-quiet" onClick={() => setOpen(!open)}>{open ? "Hide" : "Secret / assistants"}</button>
      </div>
      {open && (
        <div className="ad-form" style={{ marginTop: 8 }}>
          <label>New secret (write-only)<input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
          <div className="ad-actions">
            <button disabled={!secret || save.busy} onClick={() => run(async () => { await tools.setSecret(tool.name, secret); setSecret(""); reload(); }, "Secret stored.")}>Rotate secret</button>
            <button disabled={!tool.secret.configured || save.busy} onClick={() => window.confirm("Revoke this secret?") && run(async () => { await tools.revokeSecret(tool.name); reload(); }, "Secret revoked.")}>Revoke</button>
          </div>
          <span className="ad-muted">Assistant permission</span>
          <div className="ad-actions">
            {assistantList.map((a) => (
              <span key={a.id}>
                {a.name}: <button className="ad-quiet" disabled={save.busy} onClick={() => run(() => tools.setAssistant(tool.name, a.id, true), `Enabled for ${a.name}.`)}>Allow</button>{" "}
                <button className="ad-quiet" disabled={save.busy} onClick={() => run(() => tools.setAssistant(tool.name, a.id, false), `Disabled for ${a.name}.`)}>Deny</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Tools() {
  const { loading, error, data, reload } = useLoad(() => tools.list(), []);
  const as = useLoad(() => assistants.list(), []);
  return (
    <div>
      <h2>Tools</h2>
      {loading && <Loading />}<Banner error={error} />
      {(data?.items || []).map((t) => <ToolRow key={t.name} tool={t} assistantList={as.data?.assistants || []} reload={reload} />)}
    </div>
  );
}

export function Conversations() {
  const [q, setQ] = useState({ page: 1, pageSize: 20, q: "", status: "" });
  const [open, setOpen] = useState(null);
  const list = useLoad(() => conversations.list(q), [q.page, q.q, q.status]);
  const msgs = useLoad(() => (open ? conversations.messages(open) : Promise.resolve(null)), [open]);
  const [calls, setCalls] = useState({});
  const showCalls = async (m) => {
    try { setCalls({ ...calls, [m.id]: await conversations.toolCalls(open, m.id) }); }
    catch (e) { setCalls({ ...calls, [m.id]: { error: e.message } }); }
  };
  return (
    <div>
      <h2>Conversations</h2>
      <div className="ad-toolbar">
        <input placeholder="Search" value={q.q} onChange={(e) => setQ({ ...q, q: e.target.value, page: 1 })} />
        <select value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value, page: 1 })}>
          <option value="">All statuses</option>{["active", "closed", "archived"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {list.loading && <Loading />}<Banner error={list.error} />
      <div className="ad-table-wrap"><table className="ad-table"><tbody>
        {(list.data?.items || []).map((c) => (
          <tr key={c.id}>
            <td><button className="ad-link" onClick={() => setOpen(c.id)}>{c.title || "Untitled"}</button></td>
            <td>{c.channel}</td><td>{LANGS[c.language] || c.language}</td><td><span className="ad-pill">{c.status}</span></td><td>{fmt(c.lastMessageAt)}</td>
          </tr>
        ))}
      </tbody></table></div>
      <div className="ad-pager">
        <button disabled={q.page <= 1} onClick={() => setQ({ ...q, page: q.page - 1 })}>Previous</button>
        <span>Page {q.page} · {list.data?.total ?? 0} total</span>
        <button disabled={q.page * q.pageSize >= (list.data?.total ?? 0)} onClick={() => setQ({ ...q, page: q.page + 1 })}>Next</button>
      </div>
      {open && (
        <div className="ad-box">
          <div className="ad-actions" style={{ justifyContent: "space-between" }}><h3>Transcript</h3><button className="ad-quiet" onClick={() => setOpen(null)}>Close</button></div>
          {msgs.loading && <Loading />}<Banner error={msgs.error} />
          {(msgs.data || []).map((m) => (
            <div key={m.id} style={{ margin: "8px 0" }}>
              <span className="ad-muted">{m.role} · {m.modality} · {fmt(m.createdAt)}</span>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              {Array.isArray(m.sources) && m.sources.length > 0 && <div className="ad-muted">Sources: {m.sources.map((s) => s.title || s.id || "source").join(", ")}</div>}
              {m.toolCallsCount > 0 && (
                <div>
                  <button className="ad-quiet" onClick={() => showCalls(m)}>{m.toolCallsCount} tool call(s)</button>
                  {calls[m.id]?.error && <span className="ad-err-text"> {calls[m.id].error}</span>}
                  {Array.isArray(calls[m.id]) && calls[m.id].map((t, i) => <div key={i} className="ad-muted">{t.toolName || t.tool_name || "tool"} · {t.status || t.outcome}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function VoiceSettings() {
  const { loading, error, data } = useLoad(() => voice.capabilities(), []);
  if (loading) return <Loading />;
  if (error) return <Banner error={error} />;
  return (
    <div>
      <h2>Voice settings</h2>
      <VoiceLibrary />
      <div className="ad-cards">
        {Object.entries(data.providers).map(([k, p]) => (
          <div className="ad-card" key={k}><b>{p.healthy ? "Healthy" : "Unavailable"}</b><span>{k.toUpperCase()}: {p.engine}</span></div>
        ))}
      </div>
      <div className="ad-grid2">
        {data.languages.map((l) => (
          <div className="ad-box" key={l.code || l.language}>
            <h3>{LANGS[l.code || l.language] || l.code || l.language}</h3>
            <p className="ad-muted">Recognition: {l.recognition ? "yes" : "no"} · Speech: {l.speech ? "yes" : "text only"}</p>
            {l.textOnly && <p className="ad-muted">Replies are shown as text; no voice is available for this language.</p>}
            {(l.voices || []).map((v, i) => <div key={i}>{v.name || v.id} <span className="ad-pill">{v.gender}</span></div>)}
          </div>
        ))}
      </div>
      <div className="ad-box">
        <h3>Session limits</h3>
        <p className="ad-muted">Per tenant: {data.limits.maxSessionsPerTenant} · Per user: {data.limits.maxSessionsPerUser} · Per instance: {data.limits.maxSessionsPerInstance} · Max length: {data.limits.maxSessionSeconds}s</p>
        <p className="ad-muted">{data.scaling}</p>
      </div>
    </div>
  );
}

function VoiceLibrary() {
  const { loading, error, data, reload } = useLoad(() => voiceLibrary.list(), []);
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [consent, setConsent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [save, run] = useSave();
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const perform = (operation, message) => run(async () => { await operation(); reload(); }, message);
  return <section className="ad-box">
    <h3>Consented voice library (English preview)</h3>
    <p className="ad-muted">Recordings and speaker profiles are private to this tenant. OpenVoice V2 is a separate optional engine; Piper alone does not clone voices. Hindi and Telugu cloning are not enabled.</p>
    {!data?.providerConfigured && <p role="status">Cloning provider is not configured. Uploads can be stored, but processing and activation are unavailable until a real provider generates a preview.</p>}
    {loading && <Loading />}<Banner error={error} /><Status s={save} />
    <form className="ad-form" onSubmit={(event) => {
      event.preventDefault();
      void perform(() => voiceLibrary.upload({ name, language: "en", consent }, file), "Private recording uploaded. Select Process to generate a speaker profile.");
    }}>
      <label>Voice name<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Clean speech recording (6–120 seconds, max 20 MB)
        <input required type="file" accept=".wav,.mp3,.m4a,.mp4" onChange={(event) => setFile(event.target.files[0] || null)} />
      </label>
      <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        I am the speaker or have explicit permission to create and use this synthetic voice.
      </label>
      <button disabled={!consent || !file || save.busy}>Upload private recording</button>
    </form>
    <button className="ad-quiet" onClick={reload}>Refresh processing status</button>
    {previewUrl && <audio controls src={previewUrl} aria-label="Private voice preview" />}
    {(data?.items || []).map((profile) => <div className="ad-box" key={profile.id}>
      <b>{profile.name}</b> <span className="ad-pill">{profile.state}</span>
      <p className="ad-muted">{profile.language} · {profile.provider} · {fmt(profile.createdAt)}</p>
      {profile.error && <Banner error={profile.error} />}
      <div className="ad-actions">
        <button disabled={save.busy || !data.providerConfigured || ["processing", "active"].includes(profile.state)}
          onClick={() => perform(() => voiceLibrary.process(profile.id), "Processing queued. Refresh status shortly.")}>Process / retry</button>
        <button disabled={save.busy || !["ready", "active", "inactive"].includes(profile.state)} onClick={() => run(async () => {
          const blob = await voiceLibrary.preview(profile.id, "Hello! I am your shopping assistant. How can I help you today?");
          setPreviewUrl(URL.createObjectURL(blob));
        }, "Preview generated. Listen before activation.")}>Generate preview</button>
        <button disabled={save.busy || !["ready", "active", "inactive"].includes(profile.state)}
          onClick={() => perform(() => voiceLibrary.activate(profile.id, profile.state !== "active"), profile.state === "active" ? "Voice deactivated." : "Voice activated.")}>
          {profile.state === "active" ? "Deactivate" : "Activate after listening"}</button>
        <button disabled={save.busy || ["active", "processing"].includes(profile.state)}
          onClick={() => window.confirm("Permanently delete this private recording and speaker profile?") && perform(() => voiceLibrary.remove(profile.id), "Voice deleted.")}>Delete</button>
      </div>
    </div>)}
  </section>;
}

export function Platform() {
  const [page, setPage] = useState(1);
  const ov = useLoad(() => platform.overview(), []);
  const list = useLoad(() => platform.tenants({ page, pageSize: 20 }), [page]);
  const [save, run] = useSave();
  const toggle = (t) => {
    const next = t.status === "active" ? "suspended" : "active";
    if (!window.confirm(`Set ${t.name} to ${next}?`)) return;
    run(async () => { await platform.setStatus(t.id, next); list.reload(); ov.reload(); }, `Tenant ${next}.`);
  };
  return (
    <div>
      <h2>Platform administration</h2>
      <Banner error={ov.error} />
      {ov.data && (
        <div className="ad-cards">
          {[["Tenants", ov.data.tenants], ["Active tenants", ov.data.activeTenants], ["Assistants", ov.data.assistants], ["Conversations", ov.data.conversations], ["Enabled widgets", ov.data.enabledWidgets]]
            .map(([l, v]) => <div className="ad-card" key={l}><b>{v}</b><span>{l}</span></div>)}
        </div>
      )}
      <p className="ad-muted">Subscription and billing status are not modelled in the database yet.</p>
      <Status s={save} /><Banner error={list.error} />
      <div className="ad-table-wrap"><table className="ad-table"><tbody>
        {(list.data?.items || []).map((t) => (
          <tr key={t.id}>
            <td>{t.name} <span className="ad-muted">{t.slug}</span></td>
            <td><span className="ad-pill">{t.status}</span></td>
            <td>{t.assistants} assistants</td><td>{t.conversations} conversations</td>
            <td>{t.widgetEnabled ? "widget on" : "widget off"}</td>
            <td>{["active", "suspended"].includes(t.status) && <button className="ad-quiet" disabled={save.busy} onClick={() => toggle(t)}>{t.status === "active" ? "Suspend" : "Activate"}</button>}</td>
          </tr>
        ))}
      </tbody></table></div>
      <div className="ad-pager">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} · {list.data?.total ?? 0} total</span>
        <button disabled={page * 20 >= (list.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
