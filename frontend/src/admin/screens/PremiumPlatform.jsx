import React, { useState } from 'react';
import { platform } from '../api2.js';
import { useLoad } from '../screens.jsx';
import { MetricCard, SectionTitle } from '../components/UI';
import { 
  Users, 
  Bot, 
  MessageSquare, 
  Zap, 
  CheckCircle2,
  MoreVertical,
  Search,
  Filter
} from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

const cn = (...i) => twMerge(clsx(i));

export function PremiumPlatform() {
  const [page, setPage] = useState(1);
  const ov = useLoad(() => platform.overview(), []);
  const list = useLoad(() => platform.tenants({ page, pageSize: 20 }), [page]);
  const [saveBusy, setSaveBusy] = useState(false);

  const toggle = async (t) => {
    const next = t.status === "active" ? "suspended" : "active";
    if (!window.confirm(`Set ${t.name} to ${next}?`)) return;
    setSaveBusy(true);
    try { 
      await platform.setStatus(t.id, next); 
      list.reload(); 
      ov.reload(); 
    } catch (e) { 
      alert(e.message); 
    } finally { 
      setSaveBusy(false); 
    }
  };

  if (ov.loading && !ov.data) return <div className="p-8 text-center text-text-muted">Loading platform…</div>;

  return (
    <div className="space-y-6">
      <SectionTitle 
        title="Platform Administration" 
        subtitle="Manage all tenants, monitor global capacity, and control access." 
      />

      {/* Global KPI Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {ov.data && [
          { label: "Total Tenants", value: ov.data.tenants, icon: Users, desc: "Registered workspaces" },
          { label: "Active Tenants", value: ov.data.activeTenants, icon: Users, desc: "Currently enabled" },
          { label: "Assistants", value: ov.data.assistants, icon: Bot, desc: "Across all tenants" },
          { label: "Conversations", value: ov.data.conversations, icon: MessageSquare, desc: "Total interactions" },
          { label: "Enabled Widgets", value: ov.data.enabledWidgets, icon: Zap, desc: "Active embeds" },
        ].map((m, i) => (
          <MetricCard key={i} label={m.label} value={m.value} icon={m.icon} description={m.desc} />
        ))}
      </div>

      {/* Tenant Table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,43,42,0.04),0_18px_38px_-32px_rgba(8,94,85,0.6)]">
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold tracking-tight text-text-main">Tenant directory</h3>
            <p className="text-[11.5px] text-text-soft">Every workspace registered on this platform</p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-soft" />
              <input 
                className="pl-9 pr-3.5 py-2 bg-surface-muted/60 border border-border rounded-xl text-[13px] text-text-main placeholder:text-text-soft/80 focus:outline-none focus:border-brand-bright focus:bg-white focus:ring-[3px] focus:ring-brand-soft/70 w-52 sm:w-64" 
                placeholder="Search tenants..."
              />
            </div>
            <button aria-label="Filter tenants" className="grid h-9 w-9 place-items-center border border-border rounded-xl text-text-muted hover:text-brand-hover hover:bg-surface-muted transition-colors">
              <Filter size={15} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-text-soft bg-surface-muted/50 border-b border-border text-[10.5px] uppercase tracking-[0.08em]">
              <tr>
                <th className="px-5 py-3 font-bold">Tenant</th>
                <th className="px-5 py-3 font-bold">Status</th>
                <th className="px-5 py-3 font-bold">Assistants</th>
                <th className="px-5 py-3 font-bold">Conversations</th>
                <th className="px-5 py-3 font-bold">Widget</th>
                <th className="px-5 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(list.data?.items || []).map((t) => (
                <tr key={t.id} className="hover:bg-surface-muted/60 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-soft to-brand-mint/25 text-[12px] font-bold text-brand-hover">
                        {(t.name || '?').charAt(0).toUpperCase()}
                      </span>
                      <div className="flex flex-col">
                        <span className="font-semibold text-text-main">{t.name}</span>
                        <span className="text-[11.5px] text-text-soft">{t.slug}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide",
                      t.status === 'active' ? "bg-brand-soft text-brand-hover" : "bg-amber-50 text-amber-700"
                    )}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-text-muted">{t.assistants}</td>
                  <td className="px-5 py-4 text-text-muted">{t.conversations}</td>
                  <td className="px-5 py-4">
                    {t.widgetEnabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft/70 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-brand-hover">
                        <CheckCircle2 size={11} /> On
                      </span>
                    ) : (
                      <span className="text-text-soft text-[11.5px]">Off</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button 
                      disabled={saveBusy}
                      onClick={() => toggle(t)}
                      className="px-3 py-1.5 text-[11.5px] font-semibold border border-border rounded-lg text-text-muted hover:border-border-bright hover:text-brand-hover hover:bg-brand-soft/30 transition-colors disabled:opacity-50"
                    >
                      {t.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {(list.data?.items || []).length === 0 && (
                <tr>
                  <td colSpan="6" className="px-5 py-10 text-center text-[13px] text-text-soft">No tenants found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3.5 border-t border-border flex items-center justify-between gap-3 bg-surface-muted/40">
          <span className="text-[11.5px] text-text-muted">
            Page {page} of {Math.max(1, Math.ceil((list.data?.total || 0) / 20))} · {list.data?.total || 0} tenants
          </span>
          <div className="flex gap-2">
            <button 
              disabled={page <= 1} 
              onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 text-[11.5px] font-semibold border border-border rounded-lg bg-surface text-text-muted hover:border-border-bright hover:text-brand-hover hover:bg-brand-soft/30 disabled:opacity-50"
            >
              Previous
            </button>
            <button 
              disabled={page * 20 >= (list.data?.total || 0)} 
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 text-[11.5px] font-semibold border border-border rounded-lg bg-surface text-text-muted hover:border-border-bright hover:text-brand-hover hover:bg-brand-soft/30 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
