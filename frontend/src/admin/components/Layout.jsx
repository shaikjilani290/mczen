import React from 'react';
import {
  LayoutDashboard,
  Bot,
  Settings,
  Globe,
  BookOpen,
  FileText,
  Layers,
  FolderOpen,
  Search,
  Wrench,
  MessageSquare,
  Volume2,
  LogOut,
  Bell,
  RefreshCw,
  Calendar,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { id: 'analytics', label: 'Overview', icon: LayoutDashboard },
      { id: 'assistants', label: 'Assistants', icon: Bot },
      { id: 'widget', label: 'Widget', icon: Settings },
      { id: 'website-integrations', label: 'Website Integrations', icon: Globe },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'articles', label: 'Articles', icon: FileText },
      { id: 'categories', label: 'Categories', icon: Layers },
      { id: 'documents', label: 'Documents', icon: FolderOpen },
      { id: 'search', label: 'Search', icon: Search },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'tools', label: 'Tools', icon: Wrench },
      { id: 'conversations', label: 'Conversations', icon: MessageSquare },
      { id: 'voice', label: 'Voice', icon: Volume2 },
    ],
  },
];

export const VIEW_LABELS = NAV_GROUPS.flatMap((group) => group.items).reduce(
  (acc, item) => ({ ...acc, [item.id]: item.label }),
  { editor: 'Article editor' },
);

function BrandMark({ size = 'md' }) {
  return (
    <span
      className={cn(
        'grid place-items-center rounded-2xl bg-gradient-to-br from-brand-bright to-brand-hover text-white shadow-[0_10px_22px_-12px_rgba(0,120,111,0.85)]',
        size === 'sm' ? 'h-9 w-9' : 'h-11 w-11',
      )}
    >
      <span className={cn('font-display font-extrabold leading-none', size === 'sm' ? 'text-base' : 'text-lg')}>M</span>
    </span>
  );
}

export function Sidebar({ active, onNavigate, session, onSignOut, mobileOpen, onClose }) {
  const tenant = session?.tenant;
  const initial = (tenant?.name || 'M').trim().charAt(0).toUpperCase();

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-text-main/25 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        className={cn(
          'ad-scroll fixed inset-y-0 left-0 z-40 flex w-[272px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <BrandMark />
          <div className="leading-tight">
            <p className="font-display text-[17px] font-extrabold tracking-tight text-text-main">
              McZEN <span className="text-brand">AI</span>
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">Admin console</p>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-text-muted hover:bg-surface-muted lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-3 pb-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-text-soft">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = active === item.id || (item.id === 'articles' && active === 'editor');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onNavigate(item.id);
                        onClose?.();
                      }}
                      className={cn(
                        'group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors duration-150',
                        isActive
                          ? 'bg-brand-soft/70 text-brand-hover'
                          : 'text-text-muted hover:bg-surface-muted hover:text-text-main',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-7 w-7 place-items-center rounded-lg transition-colors duration-150',
                          isActive
                            ? 'bg-brand text-white shadow-[0_6px_14px_-8px_rgba(0,120,111,0.9)]'
                            : 'bg-surface-muted text-text-soft group-hover:bg-white group-hover:text-brand',
                        )}
                      >
                        <Icon size={15} strokeWidth={2.2} />
                      </span>
                      {item.label}
                      {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto border-t border-border px-3 py-4">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted/70 px-3 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-soft to-brand-bright/25 font-display text-sm font-bold text-brand-hover">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-text-main">{tenant?.name || 'Workspace'}</p>
              <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-soft">
                {tenant?.platform ? 'Platform admin' : 'Tenant admin'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="mt-2 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-text-muted transition-colors hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

export function Header({ title, section = 'Workspace', onRefresh, onMenu }) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between gap-4 border-b border-border bg-surface/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={onMenu}
          className="grid h-9 w-9 place-items-center rounded-xl border border-border text-text-muted hover:bg-surface-muted lg:hidden"
        >
          <Menu size={18} />
        </button>
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-soft">
          <span className="hidden sm:inline">Admin</span>
          <ChevronRight size={12} className="hidden sm:inline" />
          <span className="truncate text-brand-hover">{section}</span>
        </div>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <h1 className="hidden truncate font-display text-[15px] font-bold tracking-tight text-text-main sm:block">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-2 rounded-full border border-border bg-surface-muted/70 px-3 py-1.5 text-[11.5px] font-semibold text-text-muted md:inline-flex">
          <Calendar size={13} className="text-brand" />
          {today}
        </span>
        <button
          type="button"
          aria-label="Notifications"
          className="relative grid h-9 w-9 place-items-center rounded-full border border-border text-text-muted transition-colors hover:border-border-bright hover:text-brand-hover"
        >
          <Bell size={16} />
          <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-brand-bright ring-2 ring-white" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-brand-bright to-brand-hover px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[0_10px_20px_-12px_rgba(0,120,111,0.9)] transition-transform hover:-translate-y-px"
        >
          <RefreshCw size={14} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </header>
  );
}
