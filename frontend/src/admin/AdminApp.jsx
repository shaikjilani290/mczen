import React, { useEffect, useState, useCallback } from "react";
import { auth, setToken, setUnauthorizedHandler } from "./api.js";
import { Articles, ArticleEditor, Categories, Dashboard, Documents, SearchPanel } from "./screens.jsx";
import { Assistants, Conversations, VoiceSettings, WidgetSettings, Tools } from "./screens2.jsx";
import { PremiumAnalytics } from "./screens/PremiumAnalytics";
import { PremiumPlatform } from "./screens/PremiumPlatform";
import { WebsiteIntegrations } from "./screens/WebsiteIntegrations";
import { Sidebar, Header, VIEW_LABELS } from "./components/Layout";
import { ShieldCheck, Loader2, ArrowRight } from "lucide-react";
import "./admin.css";

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
      if (platform) return onSignedIn(result.accessToken, { name: "Platform", platform: true });
      const tenants = result.tenants || [];
      if (tenants.length === 0) throw new Error("This account has no tenant membership.");
      if (tenants.length === 1) return await activate(result.accessToken, tenants[0]);
      setLogin({ token: result.accessToken, tenants });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="ad-canvas relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-gradient-to-br from-brand-soft to-brand-mint/40 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-gradient-to-tr from-brand-mint/25 to-brand-soft/60 blur-3xl"
      />

      <div className="relative w-full max-w-[420px] rounded-[26px] border border-white/70 bg-surface/95 p-8 shadow-[0_1px_2px_rgba(15,43,42,0.05),0_40px_70px_-40px_rgba(8,94,85,0.55)] backdrop-blur-xl sm:p-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-bright to-brand-hover font-display text-xl font-extrabold text-white shadow-[0_14px_26px_-14px_rgba(0,120,111,0.9)]">
            M
          </span>
          <h1 className="mt-4 font-display text-[22px] font-extrabold tracking-tight text-text-main">
            McZEN <span className="text-brand">AI</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-text-muted">Sign in to manage your workspace</p>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-medium text-rose-700" role="alert">
            {error}
          </div>
        )}

        {!login ? (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <label htmlFor="admin-email" className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-muted">
                Email address
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@company.com"
                className="w-full rounded-xl border border-border bg-surface-muted/60 px-3.5 py-2.5 text-[13.5px] text-text-main placeholder:text-text-soft/70 transition-colors focus:border-brand-bright focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-brand-soft/70"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="admin-password" className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-muted">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-surface-muted/60 px-3.5 py-2.5 text-[13.5px] text-text-main placeholder:text-text-soft/70 transition-colors focus:border-brand-bright focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-brand-soft/70"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-surface-muted/50 px-3 py-2.5 transition-colors hover:border-border-bright">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-border accent-brand"
                checked={platform}
                onChange={(e) => setPlatform(e.target.checked)}
              />
              <ShieldCheck size={14} className="text-brand" />
              <span className="text-[12.5px] font-medium text-text-muted">Platform administrator access</span>
            </label>

            <button
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-bright to-brand-hover py-2.5 text-[13.5px] font-bold text-white shadow-[0_14px_26px_-14px_rgba(0,120,111,0.95)] transition-transform hover:-translate-y-px disabled:translate-y-0 disabled:opacity-60"
              disabled={busy}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {busy ? "Signing in..." : "Sign in"}
              {!busy && <ArrowRight size={15} />}
            </button>
          </form>
        ) : (
          <div className="space-y-2.5">
            <p className="pb-1 text-center text-[12.5px] text-text-muted">Choose a workspace to continue</p>
            {login.tenants.map((t) => (
              <button
                key={t.id}
                disabled={busy}
                onClick={() => activate(login.token, t)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-surface-muted/50 px-3.5 py-3 text-left transition-colors hover:border-brand-bright hover:bg-brand-soft/40 disabled:opacity-60"
              >
                <span className="text-[13.5px] font-semibold text-text-main">{t.name}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-brand-hover">{t.role}</span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-7 text-center text-[11.5px] text-text-soft">
          <a href="#/" className="font-semibold text-brand-hover hover:underline hover:underline-offset-2">Back to voice assistant</a>
        </p>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState({ name: "analytics", id: null });
  const [navOpen, setNavOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
  const go = useCallback((name, id = null) => setView({ name, id }), []);

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
    case "website-integrations": body = <WebsiteIntegrations />; break;
    case "tools": body = <Tools />; break;
    case "conversations": body = <Conversations />; break;
    case "voice": body = <VoiceSettings />; break;
    case "analytics": body = <PremiumAnalytics go={go} />; break;
    default: body = <PremiumAnalytics go={go} />;
  }

  const platformMode = Boolean(session.tenant.platform);
  const title = view.name === "editor" ? (view.id ? "Edit article" : "New article") : VIEW_LABELS[view.name] || "Overview";
  const section = ["articles", "categories", "documents", "search", "editor"].includes(view.name) ? "Knowledge" : "Workspace";

  return (
    <div className="ad-canvas flex min-h-screen text-text-main">
      <Sidebar
        active={view.name}
        onNavigate={go}
        session={session}
        onSignOut={signOut}
        mobileOpen={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          title={title}
          section={section}
          onMenu={() => setNavOpen(true)}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
        <main key={refreshKey} className="ad-scroll flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1320px]">
            {platformMode ? <PremiumPlatform /> : body}
          </div>
        </main>
      </div>
    </div>
  );
}
