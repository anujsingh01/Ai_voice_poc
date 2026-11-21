import { AlertTriangle, Download, MessageSquare, Trophy } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonClass } from '@/components/styles';
import { Avatar, Card, EmptyState } from '@/components/ui';
import { JobHeader } from '../job-header';
import { languageName } from '@/lib/languages';
import { DECISION_STYLE, FLAG_LABEL, jobResults, readFilter, VIEWS } from '@/lib/results';
import { inTenant, requireTenant } from '@/lib/tenant';


export default async function ResultsPage({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant(slug);
  const sp = await searchParams;
  const filter = readFilter(sp);
  const data = await inTenant(ctx, async tx => {
    const [job] = await tx`SELECT j.id, j.title, j.status, j.location, j.languages, r.shortlist_cutoff FROM jobs j
                           JOIN LATERAL (SELECT shortlist_cutoff FROM rubrics WHERE job_id = j.id ORDER BY version DESC LIMIT 1) r ON true WHERE j.id = ${id}`;
    if (!job) return null;
    return { job, ...(await jobResults(tx, id, filter)) };
  });
  if (!data) notFound();
  const { job, rows, counts } = data;
  const base = `/t/${slug}/jobs/${id}/results`;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ view: filter.view, lang: filter.language, min: filter.min?.toString(), ...patch }).filter(([, v]) => v && v !== 'all') as [string, string][]);
    return p.size ? `${base}?${p}` : base;
  };

  return (
    <>
      <JobHeader slug={slug} job={job as never} tab="results" counts={{ results: counts.all }}
                 description={<>Everyone who finished, best score first. Scores of <b className="text-slate-700">{job.shortlist_cutoff}</b> or more are suggested for the shortlist. Click a name to listen and decide; the AI only suggests.</>}
                 actions={ctx.can('manageCandidates') && <a href={`${base}/export${qs({}).replace(base, '')}`} className={buttonClass('secondary')}><Download className="size-4" /> Download Excel (CSV)</a>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {VIEWS.map(v => (
          <Link key={v.key} href={qs({ view: v.key })}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${filter.view === v.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'}`}>
            {v.label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${filter.view === v.key ? 'bg-white/20' : 'bg-slate-100'}`}>{counts[v.key]}</span>
          </Link>
        ))}
        <form className="ml-auto flex flex-wrap items-center gap-2 text-sm" action={base}>
          <input type="hidden" name="view" value={filter.view} />
          <select name="lang" defaultValue={filter.language ?? ''} aria-label="Language" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">
            <option value="">All languages</option>
            {(job.languages as string[]).map(l => <option key={l} value={l}>{languageName(l)}</option>)}
          </select>
          <input type="number" name="min" min={0} max={100} defaultValue={filter.min ?? ''} placeholder="Min score" aria-label="Minimum score"
                 className="h-9 w-28 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
          <button className={buttonClass('secondary', 'sm')}>Filter</button>
        </form>
      </div>

      {rows.length === 0 ? <EmptyState icon={<Trophy className="size-5" />}>No finished interviews here yet. Candidates appear a few minutes after they complete the interview.</EmptyState> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th className="w-12">Rank</th><th>Candidate</th><th>Score</th><th>Check</th><th>Decision</th><th>Interviewed</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const above = r.score != null && r.score >= job.shortlist_cutoff;
                  return (
                    <tr key={r.interview_id}>
                      <td className="tabular-nums font-semibold text-slate-400">{i + 1}</td>
                      <td>
                        <Link href={`/t/${slug}/interviews/${r.interview_id}`} className="flex items-center gap-3">
                          <Avatar name={r.name} size="sm" />
                          <span><span className="block font-medium text-slate-900 hover:text-brand-700">{r.name}</span>
                            <span className="block text-xs text-slate-500">{languageName(r.language)}{r.comments > 0 && <> · <MessageSquare className="inline size-3" /> {r.comments}</>}</span></span>
                        </Link>
                      </td>
                      <td>
                        {r.score == null ? <span className="text-xs text-slate-400">{r.score_status === 'paused_budget' ? 'Paused' : 'Scoring…'}</span> : (
                          <div className="flex items-center gap-3">
                            <span className={`w-9 text-lg font-semibold tabular-nums ${above ? 'text-emerald-700' : 'text-slate-900'}`}>{Math.round(r.score)}</span>
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${above ? 'bg-emerald-500' : 'bg-brand-400'}`} style={{ width: `${r.score}%` }} /></div>
                            {r.override_score != null && <span className="text-xs text-slate-500" title={`AI score ${r.ai_score?.toFixed(0)}`}>changed by recruiter</span>}
                          </div>
                        )}
                      </td>
                      <td>
                        {r.flags.length > 0
                          ? <span title={r.flags.map(f => FLAG_LABEL[f.type] ?? f.type).join(', ')} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20"><AlertTriangle className="size-3" />{FLAG_LABEL[r.flags[0].type] ?? 'Check'}{r.flags.length > 1 && ` +${r.flags.length - 1}`}</span>
                          : <span className="text-xs text-slate-300">—</span>}
                      </td>
                      <td>
                        {r.decision ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${DECISION_STYLE[r.decision][1]}`} title={r.decision_reason ?? ''}>{DECISION_STYLE[r.decision][0]}</span>
                                    : <span className="text-xs text-slate-400">Not decided</span>}
                      </td>
                      <td className="whitespace-nowrap text-slate-500">{new Date(r.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
