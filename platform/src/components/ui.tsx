import { AlertCircle, CheckCircle2, ChevronLeft, Inbox, Info, Mic, ShieldCheck, Sparkles, Waves } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Shell, type NavItem } from './app-shell';
import { buttonClass, controlClass as control } from './styles';

// ---------- Layout ----------

export function AppShell({ title, subtitle, nav, user, children }: {
  title: string; subtitle?: string; nav: NavItem[]; user: { name: string; email: string }; children: ReactNode;
}) {
  return <Shell workspace={title} workspaceSub={subtitle ?? ''} nav={nav} user={user}>{children}</Shell>;
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-brand-950 lg:flex lg:flex-col lg:justify-between p-12 text-white">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60rem_40rem_at_10%_-10%,rgba(108,99,234,0.55),transparent_60%),radial-gradient(40rem_30rem_at_110%_110%,rgba(56,189,248,0.25),transparent_60%)]" />
        <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20"><Mic className="size-4.5" /></span>
          <span className="text-lg font-semibold tracking-tight">InterviewPlatform</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Screen a thousand candidates a day, in their own language.</h2>
          <p className="mt-4 text-white/70">Voice interviews on any phone, transcribed on your own machines, scored with evidence. Your recruiters make every decision.</p>
          <ul className="mt-8 space-y-3 text-sm text-white/85">
            {[[Waves, 'Hindi, Tamil, Malayalam and 9 more languages'], [Sparkles, 'AI scores backed by quotes from the answer'], [ShieldCheck, 'DPDP-ready: consent, retention and audit built in']].map(([Icon, t]) => {
              const I = Icon as typeof Waves;
              return <li key={t as string} className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-lg bg-white/10"><I className="size-3.5" /></span>{t as string}</li>;
            })}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">Data stays in India · 2-step login for every admin</p>
      </section>

      {/* Form */}
      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white"><Mic className="size-4" /></span>
            <span className="font-semibold tracking-tight">Interview<span className="text-brand-600">Platform</span></span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <div className="mt-2 text-sm text-slate-500">{subtitle}</div>}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </main>
  );
}

export function PageHeader({ title, description, back, actions, children }: {
  title: ReactNode; description?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="mb-8">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
          <ChevronLeft className="size-4" /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {children}
        {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1.5 max-w-3xl text-sm text-slate-500">{description}</p>}
    </div>
  );
}

export function Section({ title, description, actions, children, padded = true }: {
  title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean;
}) {
  return (
    <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {title && (
        <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900">{title}</h2>
            {description && <div className="mt-0.5 text-sm text-slate-500">{description}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className={padded ? 'p-6' : ''}>{children}</div>
    </section>
  );
}

/** A plain white card for tables and lists (no padding, rounded, clipped). */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</div>;
}

export function StatCard({ label, value, sub, icon, tone = 'brand', progress, href }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'emerald' | 'amber' | 'sky' | 'rose';
  progress?: number; href?: string;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600',
    sky: 'bg-sky-50 text-sky-600', rose: 'bg-rose-50 text-rose-600',
  };
  const bar = progress == null ? null : progress >= 1 ? 'bg-rose-500' : progress >= 0.8 ? 'bg-amber-500' : 'bg-brand-500';
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon && <span className={`grid size-9 place-items-center rounded-xl ${tones[tone]}`}>{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {progress != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
    </>
  );
  const box = 'block rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]';
  return href ? <Link href={href} className={`${box} transition hover:border-brand-300 hover:shadow-md`}>{body}</Link> : <div className={box}>{body}</div>;
}

// ---------- Forms ----------


export function Field({ label, hint, ...input }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input {...input} className={`${control} h-10`} />
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Select({ label, children, ...props }: { label: string; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <select {...props} className={`${control} h-10 pr-8`}>{children}</select>
    </label>
  );
}

export function Textarea({ label, hint, ...props }: { label: string; hint?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <textarea {...props} className={`${control} leading-relaxed`} />
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}


export function Button({ variant = 'primary', size = 'md', className = '', ...props }: {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'md' | 'sm';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

export function LinkAsButton({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Link href={href} className={buttonClass(variant)}>
      {children}
    </Link>
  );
}

// ---------- Feedback ----------

export function Notice({ kind = 'error', children }: { kind?: 'error' | 'warning' | 'success' | 'info'; children: ReactNode }) {
  const s = {
    error: ['border-rose-200 bg-rose-50 text-rose-900', AlertCircle, 'text-rose-500'],
    warning: ['border-amber-200 bg-amber-50 text-amber-900', AlertCircle, 'text-amber-500'],
    success: ['border-emerald-200 bg-emerald-50 text-emerald-900', CheckCircle2, 'text-emerald-500'],
    info: ['border-brand-200 bg-brand-50 text-brand-900', Info, 'text-brand-500'],
  }[kind] as [string, typeof Info, string];
  const Icon = s[1];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`mb-5 flex gap-3 rounded-xl border px-4 py-3 text-sm ${s[0]}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${s[2]}`} />
      <div>{children}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', trial: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    suspended: 'bg-rose-50 text-rose-700 ring-rose-600/20', draft: 'bg-slate-50 text-slate-600 ring-slate-500/20',
    closed: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  };
  const dot: Record<string, string> = { active: 'bg-emerald-500', trial: 'bg-amber-500', suspended: 'bg-rose-500', draft: 'bg-slate-400', closed: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${s[status] ?? 'bg-slate-50 text-slate-600 ring-slate-500/20'}`}>
      <span className={`size-1.5 rounded-full ${dot[status] ?? 'bg-slate-400'}`} />{status}
    </span>
  );
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const palette = ['from-brand-400 to-brand-600', 'from-sky-400 to-sky-600', 'from-emerald-400 to-emerald-600', 'from-amber-400 to-orange-500', 'from-rose-400 to-pink-600', 'from-violet-400 to-fuchsia-600'];
  const i = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % palette.length;
  const text = name.split(/[\s,–-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
  return (
    <span className={`grid shrink-0 place-items-center rounded-lg bg-gradient-to-br font-semibold text-white ${palette[i]} ${size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm'}`}>
      {text}
    </span>
  );
}

export function EmptyState({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-400">{icon ?? <Inbox className="size-5" />}</span>
      <div className="text-sm text-slate-500">{children}</div>
    </div>
  );
}

export function Checkbox({ label, hint, ...props }: { label: ReactNode; hint?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg py-1 text-sm text-slate-700">
      <input type="checkbox" {...props} className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-brand-600" />
      <span>{label}{hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

/** Maps short codes in ?error= / ?msg= to fixed text, so URLs can't inject arbitrary messages. */
export function messageFor(code: string | undefined, table: Record<string, string>) {
  return code && table[code] ? table[code] : null;
}
