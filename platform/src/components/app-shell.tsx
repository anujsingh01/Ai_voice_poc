'use client';

import {
  BarChart3, Briefcase, Receipt, Building2, ClipboardCheck, ClipboardList, CreditCard, Cpu, FileCheck2, LayoutDashboard, LibraryBig,
  Lock, LogOut, Menu, MessageSquare, Mic, ScrollText, ShieldCheck, Sparkles, Users, X, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, tenants: Building2, plans: CreditCard, workers: Cpu, staff: ShieldCheck, audit: ScrollText,
  jobs: Briefcase, banks: LibraryBig, messages: MessageSquare, users: Users, consent: FileCheck2, ai: Sparkles,
  reports: BarChart3, candidates: ClipboardList, privacy: Lock, billing: Receipt, review: ClipboardCheck,
};

/** `group` starts a labelled section of the menu; `badge` is a count shown beside the label (hidden when 0). */
export type NavItem = { href: string; label: string; icon?: string; group?: string; badge?: number };

const initials = (name: string) => name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');

export function Shell({ workspace, workspaceSub, nav, user, children }: {
  workspace: string; workspaceSub: string; nav: NavItem[]; user: { name: string; email: string }; children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the mobile menu after navigating.
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) { setMenuPath(pathname); setOpen(false); }

  // The most specific matching item is active (so /t/x/jobs/123 highlights Jobs, not Overview).
  const active = nav.filter((n, i) => pathname === n.href || (i > 0 && pathname.startsWith(n.href + '/'))).sort((a, b) => b.href.length - a.href.length)[0];

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 h-16 shrink-0">
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-600/30">
          <Mic className="size-4" strokeWidth={2.4} />
        </span>
        <span className="font-semibold tracking-tight text-slate-900">Interview<span className="text-brand-600">Platform</span></span>
      </div>
      <div className="mx-3 mb-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-slate-900" title={workspace}>{workspace}</p>
        <p className="text-xs text-slate-500">{workspaceSub}</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        <ul className="space-y-0.5">
          {nav.map(n => {
            const Icon = ICONS[n.icon ?? ''] ?? LayoutDashboard;
            const isActive = active?.href === n.href;
            return (
              <li key={n.href}>
                {n.group && <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{n.group}</p>}
                <Link href={n.href} aria-current={isActive ? 'page' : undefined}
                      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                  <Icon className={`size-[18px] ${isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'}`} strokeWidth={2} />
                  <span className="flex-1">{n.label}</span>
                  {!!n.badge && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-800">{n.badge}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <Link href="/account" title="Your account: password and 2-step login" className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 hover:bg-slate-100">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-xs font-semibold text-white">
              {initials(user.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{user.name}</span>
              <span className="block truncate text-xs text-slate-500">{user.email}</span>
            </span>
          </Link>
          <form action="/logout" method="post">
            <button className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Sign out" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <span className="truncate font-semibold text-slate-900">{active?.label ?? workspace}</span>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close menu">
              <X className="size-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
