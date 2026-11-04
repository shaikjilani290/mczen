import { useCallback, useEffect, useRef, useState } from "react";
import { knowledge, languageLabel, LANGUAGES } from "./api.js";

// All content is rendered as plain text by React; nothing is injected as HTML.

export function useLoad(loader, deps) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    let live = true;
    loader().then(
      (data) => live && setState({ loading: false, error: "", data }),
      (err) => live && setState({ loading: false, error: err.message, data: null }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => run(), [run]);
  return { ...state, reload: run };
}

const Banner = ({ error }) => (error ? <div className="ad-error" role="alert">{error}</div> : null);
const Loading = () => <p className="ad-muted">Loading…</p>;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ad-pager">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pages} · {total} total</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function CategorySelect({ value, onChange, categories, allowAll }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">All categories</option>}
      {!allowAll && !value && <option value="">Select category…</option>}
      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

const LanguageSelect = ({ value, onChange, allowAll }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}>
    {allowAll && <option value="">All languages</option>}
    {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
  </select>
);

export function Dashboard({ go }) {
  const { loading, error, data } = useLoad(() => knowledge.dashboard(), []);
  if (loading) return <Loading />;
  if (error) return <Banner error={error} />;
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const cards = [
    ["Published articles", data.articlesByStatus?.published ?? 0],
    ["Draft articles", data.articlesByStatus?.draft ?? 0],
    ["Documents", sum(data.documentsByStatus)],
    ["Categories", data.categoryCount ?? 0],
  ];
  return (
    <section>
      <div className="ad-cards">
        {cards.map(([label, value]) => <div className="ad-card" key={label}><b>{value}</b><span>{label}</span></div>)}
      </div>
      <div className="ad-grid2">
        <div className="ad-box">
          <h3>Articles by language</h3>
          {Object.keys(data.articlesByLanguage || {}).length === 0 && <p className="ad-muted">No articles yet.</p>}
          {Object.entries(data.articlesByLanguage || {}).map(([k, v]) => <p key={k}>{languageLabel(k)}: <b>{v}</b></p>)}
          <h3>Documents by status</h3>
          {Object.keys(data.documentsByStatus || {}).length === 0 && <p className="ad-muted">No documents yet.</p>}
          {Object.entries(data.documentsByStatus || {}).map(([k, v]) => <p key={k}>{k}: <b>{v}</b></p>)}
        </div>
        <div className="ad-box">
          <h3>Recent articles</h3>
          {(data.recentArticles || []).length === 0 && <p className="ad-muted">Nothing here yet.</p>}
          {(data.recentArticles || []).map((a) => (
            <p key={a.id}><button className="ad-link" onClick={() => go("editor", a.id)}>{a.title}</button> <small>{a.status} · {fmt(a.updatedAt)}</small></p>
          ))}
          <button className="ad-primary" onClick={() => go("editor", null)}>New article</button>
        </div>
      </div>
    </section>
  );
}

export function Articles({ go }) {
  const [filters, setFilters] = useState({ q: "", status: "", categoryId: "", language: "", tag: "" });
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const cats = useLoad(() => knowledge.categories(), []);
  const list = useLoad(() => knowledge.articles({ ...filters, page, pageSize: 10 }), [filters, page]);
  const set = (k) => (v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  async function archive(article) {
    if (!window.confirm(`Archive "${article.title}"? It will no longer be searchable.`)) return;
    try { await knowledge.archiveArticle(article.id); setNotice(""); list.reload(); } catch (e) { setNotice(e.message); }
  }

  return (
    <section>
      <div className="ad-toolbar">
        <input placeholder="Filter by title or text…" value={filters.q} onChange={(e) => set("q")(e.target.value)} />
        <select value={filters.status} onChange={(e) => set("status")(e.target.value)}>
          <option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
        </select>
        <CategorySelect allowAll value={filters.categoryId} onChange={set("categoryId")} categories={cats.data?.categories || []} />
        <LanguageSelect allowAll value={filters.language} onChange={set("language")} />
        <input placeholder="Tag" value={filters.tag} onChange={(e) => set("tag")(e.target.value)} />
        <button className="ad-primary" onClick={() => go("editor", null)}>New article</button>
      </div>
      <Banner error={notice || list.error} />
      {list.loading ? <Loading /> : list.data && (
        list.data.items.length === 0 ? <p className="ad-muted">No articles match these filters.</p> : (
          <>
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead><tr><th>Title</th><th>Category</th><th>Language</th><th>Status</th><th>Tags</th><th>Updated</th><th /></tr></thead>
                <tbody>
                  {list.data.items.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Title"><button className="ad-link" onClick={() => go("editor", a.id)}>{a.title}</button></td>
                      <td data-label="Category">{a.categoryName}</td>
                      <td data-label="Language">{languageLabel(a.language)}</td>
                      <td data-label="Status"><span className={`ad-pill ${a.status}`}>{a.status}</span></td>
                      <td data-label="Tags">{(a.tags || []).join(", ")}</td>
                      <td data-label="Updated">{fmt(a.updatedAt)}</td>
                      <td>{a.status !== "archived" && <button className="ad-quiet" onClick={() => archive(a)}>Archive</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )
      )}
    </section>
  );
}

const emptyArticle = { title: "", summary: "", content: "", categoryId: "", language: "en", status: "draft", tags: "", sourceName: "", sourceUrl: "", referenceNote: "" };

export function ArticleEditor({ id, go }) {
  const cats = useLoad(() => knowledge.categories(), []);
  const existing = useLoad(() => (id ? knowledge.article(id) : Promise.resolve(null)), [id]);
  const [form, setForm] = useState(emptyArticle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const a = existing.data;
    if (a) setForm({ ...emptyArticle, ...a, summary: a.summary ?? "", sourceName: a.sourceName ?? "", sourceUrl: a.sourceUrl ?? "", referenceNote: a.referenceNote ?? "", tags: (a.tags || []).join(", ") });
  }, [existing.data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const blank = (v) => (v.trim() === "" ? null : v.trim());

  async function save(status) {
    setSaving(true); setError(""); setSaved("");
    const body = {
      title: form.title.trim(), content: form.content, categoryId: form.categoryId, language: form.language, status,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      summary: blank(form.summary), sourceName: blank(form.sourceName), sourceUrl: blank(form.sourceUrl), referenceNote: blank(form.referenceNote),
    };
    try {
      const result = id ? await knowledge.updateArticle(id, body) : await knowledge.createArticle(body);
      setSaved(`Saved as ${result.status}.`);
      if (!id) go("editor", result.id);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  if (id && existing.loading) return <Loading />;
  if (id && existing.error) return <Banner error={existing.error} />;
  const lang = form.language;
  return (
    <section className="ad-form">
      <Banner error={error} />
      {saved && <div className="ad-ok" role="status">{saved}</div>}
      <label>Title<input value={form.title} lang={lang} maxLength={200} onChange={set("title")} /></label>
      <div className="ad-row">
        <label>Category<CategorySelect value={form.categoryId} onChange={set("categoryId")} categories={cats.data?.categories || []} /></label>
        <label>Language<LanguageSelect value={form.language} onChange={set("language")} /></label>
      </div>
      <label>Summary<textarea rows={2} lang={lang} maxLength={1000} value={form.summary} onChange={set("summary")} /></label>
      <label>Content (plain text; HTML is stripped)<textarea rows={14} lang={lang} value={form.content} onChange={set("content")} /></label>
      <label>Tags (comma separated)<input value={form.tags} onChange={set("tags")} /></label>
      <div className="ad-row">
        <label>Source name<input value={form.sourceName} maxLength={200} onChange={set("sourceName")} /></label>
        <label>Source URL (http/https)<input value={form.sourceUrl} onChange={set("sourceUrl")} /></label>
      </div>
      <label>Reference note<input value={form.referenceNote} maxLength={500} onChange={set("referenceNote")} /></label>
      {existing.data && <p className="ad-muted">Created by {existing.data.createdBy ?? "—"} · last updated {fmt(existing.data.updatedAt)} · current status: {existing.data.status}</p>}
      <div className="ad-actions">
        <button disabled={saving} onClick={() => save("draft")}>Save as draft</button>
        <button className="ad-primary" disabled={saving} onClick={() => save("published")}>Publish</button>
        <button className="ad-quiet" onClick={() => go("articles")}>Back to list</button>
      </div>
    </section>
  );
}

export function Categories() {
  const { loading, error, data, reload } = useLoad(() => knowledge.categories(), []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");

  async function act(fn) {
    setNotice("");
    try { await fn(); reload(); } catch (e) { setNotice(e.message); }
  }
  async function create(e) {
    e.preventDefault();
    await act(async () => { await knowledge.createCategory({ name: name.trim(), description: description.trim() || null }); setName(""); setDescription(""); });
  }
  async function rename(c) {
    const next = window.prompt("Category name", c.name);
    if (next && next.trim() !== c.name) await act(() => knowledge.updateCategory(c.id, { name: next.trim() }));
  }
  async function remove(c) {
    if (window.confirm(`Delete category "${c.name}"?`)) await act(() => knowledge.deleteCategory(c.id));
  }

  return (
    <section>
      <form className="ad-toolbar" onSubmit={create}>
        <input required placeholder="New category name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button className="ad-primary" type="submit">Add category</button>
      </form>
      <Banner error={notice || error} />
      {loading ? <Loading /> : data && (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>Name</th><th>Articles</th><th>Documents</th><th>Type</th><th /></tr></thead>
            <tbody>
              {data.categories.map((c) => (
                <tr key={c.id}>
                  <td data-label="Name">{c.name}{c.description && <small className="ad-muted"> — {c.description}</small>}</td>
                  <td data-label="Articles">{c.articleCount}</td>
                  <td data-label="Documents">{c.documentCount}</td>
                  <td data-label="Type">{c.isSystem ? "Default" : "Custom"}</td>
                  <td>
                    {!c.isSystem && <><button className="ad-quiet" onClick={() => rename(c)}>Rename</button> <button className="ad-quiet" onClick={() => remove(c)}>Delete</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UploadForm({ categories, onDone }) {
  const [file, setFile] = useState(null);
  const [fields, setFields] = useState({ title: "", categoryId: "", language: "en", publication: "draft", sourceName: "" });
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const input = useRef(null);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  async function submit(e) {
    e.preventDefault();
    if (!file) return setError("Choose a PDF, DOCX or TXT file first.");
    if (file.size > 10 * 1024 * 1024) return setError("File is larger than the 10 MB limit.");
    setError(""); setProgress(0);
    try {
      await knowledge.uploadDocument({ ...fields, title: fields.title.trim() || file.name }, file, setProgress);
      setFile(null); if (input.current) input.current.value = "";
      setFields((f) => ({ ...f, title: "", sourceName: "" }));
      onDone();
    } catch (err) { setError(err.message); } finally { setProgress(null); }
  }

  return (
    <form className="ad-box ad-form" onSubmit={submit}>
      <h3>Upload document</h3>
      <Banner error={error} />
      <input ref={input} type="file" accept=".pdf,.docx,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="ad-row">
        <label>Title<input value={fields.title} maxLength={200} placeholder="Defaults to file name" onChange={set("title")} /></label>
        <label>Source name<input value={fields.sourceName} maxLength={200} onChange={set("sourceName")} /></label>
      </div>
      <div className="ad-row">
        <label>Category<CategorySelect value={fields.categoryId} onChange={set("categoryId")} categories={categories} /></label>
        <label>Language<LanguageSelect value={fields.language} onChange={set("language")} /></label>
        <label>Visibility
          <select value={fields.publication} onChange={set("publication")}><option value="draft">Draft</option><option value="published">Published</option></select>
        </label>
      </div>
      {progress !== null && <progress value={progress} max="100" aria-label="Upload progress">{progress}%</progress>}
      <button className="ad-primary" disabled={progress !== null || !fields.categoryId}>{progress !== null ? `Uploading ${progress}%` : "Upload"}</button>
    </form>
  );
}

export function Documents() {
  const [filters, setFilters] = useState({ q: "", status: "", categoryId: "", language: "" });
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const cats = useLoad(() => knowledge.categories(), []);
  const list = useLoad(() => knowledge.documents({ ...filters, page, pageSize: 10 }), [filters, page]);
  const set = (k) => (v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  // Documents are processed inline, but poll while any is still pending/processing.
  const busy = list.data?.items.some((d) => d.status === "pending" || d.status === "processing");
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(list.reload, 3000);
    return () => clearTimeout(timer);
  }, [busy, list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn) {
    setNotice("");
    try { await fn(); list.reload(); } catch (e) { setNotice(e.message); }
  }

  return (
    <section>
      <UploadForm categories={cats.data?.categories || []} onDone={list.reload} />
      <div className="ad-toolbar">
        <input placeholder="Filter by title…" value={filters.q} onChange={(e) => set("q")(e.target.value)} />
        <select value={filters.status} onChange={(e) => set("status")(e.target.value)}>
          <option value="">All statuses</option>
          {["pending", "processing", "processed", "failed", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <CategorySelect allowAll value={filters.categoryId} onChange={set("categoryId")} categories={cats.data?.categories || []} />
        <LanguageSelect allowAll value={filters.language} onChange={set("language")} />
      </div>
      <Banner error={notice || list.error} />
      {list.loading && !list.data ? <Loading /> : list.data && (
        list.data.items.length === 0 ? <p className="ad-muted">No documents found.</p> : (
          <>
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead><tr><th>Document</th><th>Category</th><th>Language</th><th>Processing</th><th>Visibility</th><th>Chunks</th><th /></tr></thead>
                <tbody>
                  {list.data.items.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Document">{d.title}<small className="ad-muted"> {d.filename} · {(d.byteSize / 1024).toFixed(1)} KB</small></td>
                      <td data-label="Category">{d.categoryName}</td>
                      <td data-label="Language">{languageLabel(d.language)}</td>
                      <td data-label="Processing">
                        <span className={`ad-pill ${d.status}`}>{d.status}</span>
                        {d.status === "failed" && <small className="ad-err-text"> {d.errorMessage || d.errorCode}</small>}
                      </td>
                      <td data-label="Visibility">{d.publication}</td>
                      <td data-label="Chunks">{d.chunkCount}</td>
                      <td className="ad-actions-cell">
                        {d.status !== "archived" && <>
                          <button className="ad-quiet" onClick={() => act(() => knowledge.updateDocument(d.id, { publication: d.publication === "published" ? "draft" : "published" }))}>{d.publication === "published" ? "Unpublish" : "Publish"}</button>
                          <button className="ad-quiet" onClick={() => act(() => knowledge.reprocessDocument(d.id))}>Reprocess</button>
                          <button className="ad-quiet" onClick={() => act(() => knowledge.downloadDocument(d.id, d.filename))}>Download</button>
                          <button className="ad-quiet" onClick={() => window.confirm(`Archive "${d.title}"?`) && act(() => knowledge.archiveDocument(d.id))}>Archive</button>
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )
      )}
    </section>
  );
}

export function SearchPanel() {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({ categoryId: "", language: "" });
  const [state, setState] = useState({ loading: false, error: "", data: null });
  const cats = useLoad(() => knowledge.categories(), []);

  async function run(e) {
    e.preventDefault();
    if (!q.trim()) return;
    setState({ loading: true, error: "", data: null });
    try { setState({ loading: false, error: "", data: await knowledge.search({ q: q.trim(), ...filters }) }); }
    catch (err) { setState({ loading: false, error: err.message, data: null }); }
  }

  return (
    <section>
      <form className="ad-toolbar" onSubmit={run}>
        <input placeholder="Search published knowledge (English, Hindi, Telugu)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <CategorySelect allowAll value={filters.categoryId} onChange={(v) => setFilters((f) => ({ ...f, categoryId: v }))} categories={cats.data?.categories || []} />
        <LanguageSelect allowAll value={filters.language} onChange={(v) => setFilters((f) => ({ ...f, language: v }))} />
        <button className="ad-primary" disabled={state.loading}>Search</button>
      </form>
      <Banner error={state.error} />
      {state.loading && <Loading />}
      {state.data && state.data.results.length === 0 && <p className="ad-muted">No published results.</p>}
      {state.data?.results.map((r) => (
        <article className="ad-box" key={`${r.kind}:${r.sourceId}`}>
          <h3>{r.title} <small className="ad-muted">{r.kind} · {r.category} · {languageLabel(r.language)}</small></h3>
          <p lang={r.language}>{r.excerpt}</p>
          <small className="ad-muted">Source: {r.sourceName || r.source}</small>
        </article>
      ))}
    </section>
  );
}
