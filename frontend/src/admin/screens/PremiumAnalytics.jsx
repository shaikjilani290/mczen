import React, { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  Clock3,
  FileText,
  Globe,
  Layers,
  MessageSquare,
  Palette,
  Sparkles,
  Volume2,
  Wrench,
  Zap,
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { knowledge } from "../api.js";
import { assistants as assistantsApi, conversations, tools, widget } from "../api2.js";
import { useLoad } from "../screens.jsx";
import { EmptyState } from "../components/UI";
import { AnalyticsChart } from "../components/Charts";

const cn = (...inputs) => twMerge(clsx(inputs));

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const CARD =
  "rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(15,43,42,0.04),0_18px_38px_-32px_rgba(8,94,85,0.6)]";

const iso = (date) => date.toISOString().slice(0, 10);

function rangeFor(days) {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  return { from: iso(from), to: iso(to) };
}

const num = (value) => new Intl.NumberFormat("en-IN").format(Number(value) || 0);
const share = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

function relative(value) {
  if (!value) return "—";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function MiniBars({ points }) {
  const max = Math.max(1, ...points.map((point) => point.total));
  return (
    <div className="flex h-16 items-end gap-1" aria-hidden="true">
      {points.map((point) => (
        <span
          key={point.day}
          className={cn(
            "w-3 rounded-md transition-all",
            point.total
              ? "bg-gradient-to-t from-brand-hover/45 to-brand-bright"
              : "bg-surface-sunken",
          )}
          style={{ height: `${point.total ? Math.max(14, (point.total / max) * 100) : 8}%` }}
          title={`${point.day}: ${point.total}`}
        />
      ))}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, caption }) {
  return (
    <div className={cn(CARD, "p-4")}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft/70 text-brand-hover">
        <Icon size={15} strokeWidth={2.2} />
      </span>
      <p className="mt-3 font-display text-[22px] font-extrabold leading-none tracking-tight text-text-main">{value}</p>
      <p className="mt-1.5 text-[12px] font-semibold text-text-main/80">{label}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-text-soft">{caption}</p>
    </div>
  );
}

function RailCard({ title, action, children }) {
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="font-display text-[13px] font-bold tracking-tight text-text-main">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PremiumAnalytics({ go = () => {} }) {
  const [days, setDays] = useState(30);
  const range = useMemo(() => rangeFor(days), [days]);

  const { loading, error, data } = useLoad(() => widget.analytics(range), [range.from, range.to]);
  const recent = useLoad(
    () => conversations.list({ page: 1, pageSize: 6, sortBy: "updatedAt", sortOrder: "desc" }),
    [],
  );
  const assistantList = useLoad(() => assistantsApi.list(), []);
  const knowledgeStats = useLoad(() => knowledge.dashboard(), []);
  const widgetSettings = useLoad(() => widget.settings(), []);
  const toolList = useLoad(() => tools.list(), []);

  if (loading && !data) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-16 w-64 rounded-xl bg-surface" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="h-52 rounded-2xl bg-surface" />
              <div className="h-52 rounded-2xl bg-surface" />
            </div>
            <div className="h-72 rounded-2xl bg-surface" />
          </div>
          <div className="h-80 rounded-2xl bg-surface" />
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>;
  }
  if (!data) return null;

  const t = data.totals || {};
  const voice = Number(t.voiceConversations) || 0;
  const total = Number(t.conversations) || 0;
  const text = Number(t.textConversations) || 0;
  const voiceShare = share(voice, total);
  const toolRuns = (data.toolUsage || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const languages = (data.languageDistribution || []).length;
  const assistants = assistantList.data?.assistants || data.assistantUsage || [];
  const primary = assistants[0];
  const enabledTools = (toolList.data?.items || []).filter((item) => item.enabled);
  const widgetSettingsData = widgetSettings.data;

  const window7 = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const day = iso(date);
    const found = (data.dailyConversations || []).find((row) => row.day === day);
    return { day, total: Number(found?.total) || 0 };
  });

  const articles = knowledgeStats.data?.articlesByStatus || {};
  const documents = knowledgeStats.data?.documentsByStatus || {};
  const published = Number(articles.published) || 0;
  const drafts = Number(articles.draft) || 0;
  const processed = Number(documents.processed) || 0;
  const inFlight = (Number(documents.pending) || 0) + (Number(documents.processing) || 0);
  const categories = Number(knowledgeStats.data?.categoryCount) || 0;
  const documentTotal = processed + inFlight;

  const rows = recent.data?.items || [];
  const totalConversations = recent.data?.total ?? recent.data?.items?.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-brand-bright">
            <Sparkles size={12} /> Workspace intelligence
          </p>
          <h2 className="mt-1.5 font-display text-[26px] font-extrabold tracking-tight text-text-main">Platform Analytics</h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-text-muted">
            Real-time insights into your AI assistant’s performance and user engagement.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-[0_10px_24px_-20px_rgba(8,94,85,0.6)]">
          {RANGES.map((item) => (
            <button
              key={item.days}
              onClick={() => setDays(item.days)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold transition-colors",
                days === item.days
                  ? "bg-gradient-to-br from-brand to-brand-hover text-white shadow-[0_8px_18px_-10px_rgba(0,120,111,0.9)]"
                  : "text-text-muted hover:bg-surface-muted hover:text-brand-hover",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_318px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            {/* AI impact */}
            <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-brand-soft/70 via-surface to-surface p-5 shadow-[0_1px_2px_rgba(15,43,42,0.04),0_18px_38px_-32px_rgba(8,94,85,0.6)]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-10 -top-14 h-36 w-36 rounded-full bg-brand-bright/15 blur-2xl"
              />
              <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-brand-hover">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-white/70 text-brand-hover shadow-sm">
                  <Sparkles size={12} />
                </span>
                AI impact
              </div>

              <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
                <div>
                  <p className="font-display text-[46px] font-extrabold leading-none tracking-tight text-brand-deep">
                    {voiceShare}%
                  </p>
                  <p className="mt-2 text-[12.5px] font-semibold text-text-main/80">Voice-led sessions</p>
                  <p className="mt-0.5 text-[11.5px] text-text-muted">
                    {num(voice)} of {num(total)} conversations
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 pb-1">
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-text-soft">Last 7 days</span>
                  <MiniBars points={window7} />
                </div>
              </div>

              <div className="mt-5 space-y-2.5">
                {[
                  { label: "Voice", value: voice, icon: Volume2 },
                  { label: "Text", value: text, icon: MessageSquare },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2.5">
                    <row.icon size={13} className="text-brand-hover" />
                    <span className="w-10 text-[11px] font-semibold text-text-muted">{row.label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/80 ring-1 ring-inset ring-border">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-brand-bright to-brand-hover"
                        style={{ width: `${share(row.value, total)}%` }}
                      />
                    </span>
                    <span className="w-6 text-right text-[11px] font-bold text-text-main">{num(row.value)}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Period overview */}
            <section className={cn(CARD, "p-5")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-[14px] font-bold tracking-tight text-text-main">This period</h3>
                  <p className="mt-0.5 text-[11px] text-text-soft">
                    {range.from} → {range.to}
                  </p>
                </div>
                <span className="rounded-full bg-brand-soft/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-hover">
                  {days} days
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">

                {[
                  { label: "Conversations", value: total, caption: "Sessions started", icon: MessageSquare },
                  { label: "Messages", value: t.messages, caption: "Turns exchanged", icon: Zap },
                  { label: "Voice", value: voice, caption: "Audio interactions", icon: Volume2 },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-xl border border-border bg-surface-muted/60 px-3 py-3">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-text-soft">
                      <tile.icon size={11} /> {tile.label}
                    </span>
                    <p className="mt-2 font-display text-[24px] font-extrabold leading-none tracking-tight text-text-main">
                      {num(tile.value)}
                    </p>
                    <p className="mt-1 text-[10.5px] text-text-soft">{tile.caption}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-[11.5px] text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Bot size={13} className="text-brand-hover" />
                  {assistants.length} assistant{assistants.length === 1 ? "" : "s"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe size={13} className="text-brand-hover" />
                  {languages || 0} language{languages === 1 ? "" : "s"} active
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Activity size={13} className="text-brand-hover" />
                  {num(t.activeVoiceSessions)} live now
                </span>
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <AnalyticsChart
              title="Conversations over time"
              subtitle="Daily session volume in the selected range"
              type="area"
              height="h-[228px]"
              data={data.dailyConversations}
              nameKey="day"
              dataKey="total"
            />
            <div className="grid grid-cols-2 gap-4">
              <StatTile icon={Activity} label="Live sessions" value={num(t.activeVoiceSessions)} caption="Connected right now" />
              <StatTile icon={BookOpen} label="Knowledge hits" value={num(t.knowledgeArticles)} caption="Cited in answers" />
              <StatTile icon={Wrench} label="Tool runs" value={num(toolRuns)} caption={`${enabledTools.length} tools enabled`} />
              <StatTile icon={Layers} label="Published" value={num(t.publishedKnowledgeArticles)} caption="Articles in the index" />
            </div>
          </div>

          {/* Recent conversations */}
          <section className={cn(CARD, "overflow-hidden")}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="font-display text-[14px] font-bold tracking-tight text-text-main">Recent conversations</h3>
                <p className="mt-0.5 text-[11.5px] text-text-soft">Latest sessions across voice, text and widget</p>
              </div>
              <button
                onClick={() => go("conversations")}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-[11.5px] font-semibold text-text-muted transition-colors hover:border-brand-bright hover:text-brand-hover"
              >
                View all <ArrowUpRight size={13} />
              </button>
            </div>

            {rows.length === 0 ? (
              <div className="px-5 py-6">
                <EmptyState>No conversations yet — they appear here as soon as someone talks to your assistant.</EmptyState>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="border-b border-border bg-surface-muted/40 text-[10px] font-bold uppercase tracking-[0.08em] text-text-soft">
                    <tr>
                      <th className="px-5 py-2.5">Conversation</th>
                      <th className="px-3 py-2.5">Channel</th>
                      <th className="px-3 py-2.5 text-right">Messages</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-5 py-2.5 text-right">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-surface-muted/50">
                        <td className="px-5 py-3">
                          <p className="truncate font-semibold text-text-main">{row.title || "Untitled conversation"}</p>
                          <p className="mt-0.5 text-[10.5px] text-text-soft">
                            {row.language ? row.language.toUpperCase() : "—"} · {row.id.slice(0, 8)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-[10.5px] font-semibold capitalize text-text-muted">
                            {row.channel === "voice" ? <Volume2 size={11} /> : <MessageSquare size={11} />}
                            {row.channel}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[11.5px] text-text-muted">{num(row.messageCount)}</td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                              row.status === "open"
                                ? "bg-brand-soft text-brand-hover"
                                : "bg-surface-muted text-text-soft",
                            )}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right text-[11px] text-text-soft">{relative(row.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-muted/40 px-5 py-2.5 text-[11px] text-text-muted">
              <span>Showing {rows.length} of {num(totalConversations)}</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 size={12} /> Live data
              </span>
            </div>
          </section>
        </div>

        {/* Right rail */}
        <aside className="min-w-0 space-y-4">
          <section className={cn(CARD, "overflow-hidden")}>
            <div className="relative overflow-hidden bg-gradient-to-br from-brand-hover to-brand-deep p-4 text-white">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-14 -left-6 h-24 w-24 rounded-full border border-white/15"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">Virtual assistant</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide">
                  {primary?.status || "Active"}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25">
                  <Bot size={20} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold">{primary?.name || "Your assistant"}</p>
                  <p className="mt-0.5 text-[10.5px] text-white/70">
                    Config v{primary?.configVersion ?? 1} · {enabledTools.length} tools
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <p className="rounded-xl border border-border bg-surface-muted/60 px-3 py-2.5 text-[11.5px] leading-relaxed text-text-muted">
                Answers from your verified knowledge base, in English, Hindi and Telugu — by voice or text.
              </p>
              <button
                onClick={() => go("assistants")}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand to-brand-hover px-3 py-2.5 text-[12px] font-bold text-white shadow-[0_12px_24px_-14px_rgba(0,120,111,0.9)] transition-transform hover:-translate-y-0.5"
              >
                Manage assistant <ArrowRight size={14} />
              </button>
            </div>
          </section>

          <RailCard
            title="Knowledge base"
            action={
              <button onClick={() => go("articles")} className="text-[11px] font-semibold text-brand-hover hover:underline">
                Open
              </button>
            }
          >
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="inline-flex items-center gap-2 text-text-muted">
                  <FileText size={13} className="text-brand-hover" /> Articles
                </span>
                <span className="font-semibold text-text-main">
                  {num(published)} <span className="text-text-soft">/ {num(published + drafts)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="inline-flex items-center gap-2 text-text-muted">
                  <BookOpen size={13} className="text-brand-hover" /> Documents
                </span>
                <span className="font-semibold text-text-main">
                  {num(processed)} <span className="text-text-soft">/ {num(documentTotal)}</span>
                </span>
              </div>
              <span className="block h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-brand-bright to-brand-hover"
                  style={{ width: `${share(processed, documentTotal || 1)}%` }}
                />
              </span>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2.5 text-[12px]">
                <span className="inline-flex items-center gap-2 text-text-muted">
                  <Layers size={13} className="text-brand-hover" /> Categories
                </span>
                <span className="font-semibold text-text-main">{num(categories)}</span>
              </div>
            </div>
          </RailCard>

          <RailCard
            title="Web widget"
            action={
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
                  widgetSettingsData?.enabled ? "bg-brand-soft text-brand-hover" : "bg-surface-muted text-text-soft",
                )}
              >
                {widgetSettingsData?.enabled ? "Enabled" : "Off"}
              </span>
            }
          >
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2.5">
                <span
                  className="grid h-8 w-8 place-items-center rounded-lg text-white"
                  style={{ backgroundColor: widgetSettingsData?.primaryColor || "#009689" }}
                >
                  <Palette size={14} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-text-main">
                    {widgetSettingsData?.name || "Website widget"}
                  </p>
                  <p className="text-[10.5px] capitalize text-text-soft">
                    {widgetSettingsData?.position?.replace("-", " ") || "bottom right"} · {widgetSettingsData?.theme || "auto"} theme
                  </p>
                </div>
              </div>
              <button
                onClick={() => go("widget")}
                className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2 text-[11.5px] font-semibold text-text-muted transition-colors hover:border-brand-bright hover:text-brand-hover"
              >
                Widget settings <ArrowRight size={13} />
              </button>
            </div>
          </RailCard>
        </aside>
      </div>
    </div>
  );
}
