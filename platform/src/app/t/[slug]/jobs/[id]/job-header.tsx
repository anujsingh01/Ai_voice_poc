import { ChevronLeft, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/ui';

export type JobTab = 'results' | 'candidates' | 'settings' | 'accuracy';

const TABS: { key: JobTab; label: string; path: string }[] = [
  { key: 'results', label: 'Results', path: '/results' },
  { key: 'candidates', label: 'Candidates', path: '/candidates' },
  { key: 'settings', label: 'Settings & scoring', path: '' },
  { key: 'accuracy', label: 'AI accuracy check', path: '/calibration' },
];

/** Every page of a job shares this header, so Results, Candidates and Settings are one click apart. */
export function JobHeader({ slug, job, tab, description, actions, counts }: {
  slug: string; job: { id: string; title: string; status: string; location?: string | null }; tab: JobTab;
  description?: ReactNode; actions?: ReactNode; counts?: Partial<Record<JobTab, number>>;
}) {
  const base = `/t/${slug}/jobs/${job.id}`;
  return (
    <div className="mb-6">
      <Link href={`/t/${slug}/jobs`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ChevronLeft className="size-4" /> All jobs
      </Link>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{job.title}</h1>
        <StatusBadge status={job.status} />
        {job.location && <span className="inline-flex items-center gap-1 text-sm text-slate-500"><MapPin className="size-3.5" />{job.location}</span>}
      </div>
      <nav aria-label="Job sections" className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(t => (
          <Link key={t.key} href={base + t.path} aria-current={t.key === tab ? 'page' : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${t.key === tab ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}>
            {t.label}
            {counts?.[t.key] != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600">{counts[t.key]}</span>}
          </Link>
        ))}
      </nav>
      {(description || actions) && (
        <div className="mt-4 flex flex-wrap items-start gap-3">
          {description && <p className="max-w-3xl flex-1 text-sm text-slate-500">{description}</p>}
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}

/** Where a job opens from the list: results once someone has finished, otherwise the step that comes next. */
export function jobHome(slug: string, j: { id: string; status: string; completed: number }) {
  const base = `/t/${slug}/jobs/${j.id}`;
  return j.status === 'draft' ? base : j.completed > 0 ? `${base}/results` : `${base}/candidates`;
}
