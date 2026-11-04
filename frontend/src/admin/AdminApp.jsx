import { useEffect, useState } from "react";
import { auth, setToken, setUnauthorizedHandler } from "./api.js";
import { Articles, ArticleEditor, Categories, Dashboard, Documents, SearchPanel } from "./screens.jsx";
import { Analytics, Assistants, Conversations, Platform, Tools, VoiceSettings, WidgetSettings } from "./screens2.jsx";
import "./admin.css";

const NAV = [
  ["analytics", "Dashboard"],
  ["assistants", "Assistants"],
  ["widget", "Widget"],
  ["dashboard", "Knowledge"],
  ["articles", "Articles"],
  ["categories", "Categories"],
  ["documents", "Documents"],
  ["search", "Search"],
  ["tools", "Tools"],
  ["conversations", "Conversations"],
  ["voice", "Voice"],
];

function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [login, setLogin] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState(false);

  async function activate(loginToken, tenant) {
    setBusy(true); setError("");
    try {
      const result = await auth.activate(loginToken, tenant.id);
      onSignedIn(result.accessToken, tenant);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await auth.signIn(email.trim(), password);
      setPassword("");
      // Platform access is verified server-side on every request; the identity token is used as-is.
      if (platform) return onSignedIn(result.accessToken, { name: "Platform", platform: true });
      const tenants = result.tenants || [];
      if (tenants.length === 0) throw new Error("This account has no tenant membership.");
      if (tenants.length === 1) return await activate(result.accessToken, tenants[0]);
      setLogin({ token: result.accessToken, tenants });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="ad-login">
      <h1>McZEN Knowledge Admin</h1>
      {error && <div className="ad-error" role="alert">{error}</div>}
      {!login ? (
        <form className="ad-form" onSubmit={submit}>
          <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" style={{ width: "auto" }} checked={platform} onChange={(e) => setPlatform(e.target.checked)} />Platform administrator</label>
          <button className="ad-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      ) : (
        <div className="ad-form">
          <p>Choose a workspace</p>
          {login.tenants.map((t) => <button key={t.id} disabled={busy} onClick={() => activate(login.token, t)}>{t.name} <small>({t.role})</small></button>)}
        </div>
      )}
      <p className="ad-muted"><a href="#/">Back to voice assistant</a></p>
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState({ name: "analytics", id: null });

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setSession(null); });
    return () => setUnauthorizedHandler(() => {});
  }, []);

  function signedIn(token, tenant) {
    setToken(token);
    setSession({ tenant });
  }
  async function signOut() {
    await auth.signOut();
    setToken(null);
    setSession(null);
  }
  const go = (name, id = null) => setView({ name, id });

  if (!session) return <SignIn onSignedIn={signedIn} />;

  let body;
  switch (view.name) {
    case "articles": body = <Articles go={go} />; break;
    case "editor": body = <ArticleEditor key={view.id ?? "new"} id={view.id} go={go} />; break;
    case "categories": body = <Categories />; break;
    case "documents": body = <Documents />; break;
    case "search": body = <SearchPanel />; break;
    case "dashboard": body = <Dashboard go={go} />; break;
    case "assistants": body = <Assistants />; break;
    case "widget": body = <WidgetSettings />; break;
    case "tools": body = <Tools />; break;
    case "conversations": body = <Conversations />; break;
    case "voice": body = <VoiceSettings />; break;
    default: body = <Analytics />;
  }
  const active = view.name === "editor" ? "articles" : view.name;
  const platformMode = Boolean(session.tenant.platform);

  return (
    <div className="ad-shell">
      <header className="ad-header">
        <b>McZEN Admin</b>
        <span className="ad-muted">{session.tenant.name}</span>
        <nav>
          {!platformMode && NAV.map(([key, label]) => <button key={key} className={active === key ? "on" : ""} onClick={() => go(key)}>{label}</button>)}
        </nav>
        <button className="ad-quiet" onClick={signOut}>Sign out</button>
      </header>
      <main className="ad-main">{platformMode ? <Platform /> : body}</main>
    </div>
  );
}
