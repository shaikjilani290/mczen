import React from 'react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TrendingUp, TrendingDown } from 'lucide-react';

const cn = (...inputs) => twMerge(clsx(inputs));

export function MetricCard({ label, value, icon: Icon, trend, description, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-soft/70 text-brand-hover',
    mint: 'bg-brand-mint/15 text-brand',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-surface-muted text-text-muted',
  };

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(15,43,42,0.04),0_18px_38px_-32px_rgba(8,94,85,0.6)] transition-all duration-300 hover:-translate-y-0.5 hover:border-border-bright hover:shadow-[0_1px_2px_rgba(15,43,42,0.05),0_22px_44px_-30px_rgba(8,94,85,0.45)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-gradient-to-br from-brand-bright/12 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="flex items-start justify-between gap-3">
        <span className={cn('grid h-10 w-10 place-items-center rounded-xl', tones[tone] || tones.brand)}>
          <Icon size={18} strokeWidth={2.1} />
        </span>
        {typeof trend === 'number' && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold',
              trend > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600',
            )}
          >
            {trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend > 0 ? '+' : ''}
            {trend}%
          </span>
        )}
      </div>

      <p className="mt-4 font-display text-[28px] font-extrabold leading-none tracking-tight text-text-main">{value}</p>
      <p className="mt-1.5 text-[12.5px] font-semibold text-text-main/80">{label}</p>
      {description && <p className="mt-1 text-[11.5px] leading-snug text-text-soft">{description}</p>}
    </div>
  );
}

export function SectionTitle({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-[22px] font-extrabold tracking-tight text-text-main">{title}</h2>
        {subtitle && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function DataCard({ title, subtitle, children, footer, action }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(15,43,42,0.04),0_18px_38px_-32px_rgba(8,94,85,0.6)]">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="font-display text-[14px] font-bold tracking-tight text-text-main">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11.5px] text-text-soft">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="flex-1 px-5 py-5">{children}</div>
      {footer && <div className="border-t border-border bg-surface-muted/50 px-5 py-3 text-[11.5px] text-text-muted">{footer}</div>}
    </section>
  );
}

export function EmptyState({ children }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-muted/40 px-6 py-10 text-center">
      <p className="text-[13px] font-medium text-text-muted">{children}</p>
    </div>
  );
}
