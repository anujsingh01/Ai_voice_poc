import { ArrowRight, Briefcase, CheckCircle2, Circle, ClipboardCheck, Gauge, Mic } from 'lucide-react';
import Link from 'next/link';
import { Avatar, Card, PageHeader, Section, StatCard, StatusBadge } from '@/components/ui';
import { languageName } from '@/lib/languages';
import { awaitingDecisionCount } from '@/lib/results';
import { inTenant, invitesThisMonth, requireTenant, tenantLimits } from '@/lib/tenant';
import { jobHome } from './jobs/[id]/job-header';

const SCORE_STATUS: Record<string, [string, string]> = {
  scored: ['Scored', 'text-emerald-700 bg-emerald-50 ring-emerald-600/20'],
  needs_review: ['Flagged: check', 'text-amber-800 bg-amber-50 ring-amber-600/20'],
  queued: ['Scoring…', 'text-brand-700 bg-brand-50 ring-brand-600/20'],
  scoring: ['Scoring…', 'text-brand-700 bg-brand-50 ring-brand-600/20'],
  waiting: ['Transcribing…', 'text-slate-600 bg-slate-50 ring-slate-500/20'],
  paused_budget: ['Paused: budget', 'text-rose-700 bg-rose-50 ring-rose-600/20'],
  failed: ['Failed', 'text-rose-700 bg-rose-50 ring-rose-600/20'],
};

export default async function TenantHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const d = await inTenant(ctx, async tx => ({
    limits: await tenantLimits(tx, ctx.tenant.id),
    used: await invitesThisMonth(tx),
    jobs: (await tx`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*)::int AS total FROM jobs`)[0],
    banks: (await tx`SELECT count(*)::int AS n FROM question_banks`)[0].n as number,
    consent: (await tx`SELECT count(*)::int AS n FROM consent_texts`)[0].n as number,
    toReview: await awaitingDecisionCount(tx),
    liveJobs: await tx`
      SELECT j.id, j.title, j.status, (SELECT count(*) FROM interviews iv WHERE iv.job_id = j.id AND iv.status = 'completed')::int AS completed
      FROM jobs j WHERE j.status = 'active' ORDER BY j.created_at DESC LIMIT 8`,
    stats: (await tx`
      SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed,
             count(*) FILTER (WHERE score_status = 'needs_review')::int AS review,
             round(avg(final_score))::int AS avg_score
      FROM interviews`)[0],
    recent: await tx`
      SELECT iv.id, iv.status, iv.score_status, iv.final_score, iv.language, coalesce(iv.completed_at, iv.started_at) AS at, c.name, j.title
      FROM interviews iv JOIN candidates c ON c.id = iv.candidate_id JOIN jobs j ON j.id = iv.job_id
      ORDER BY coalesce(iv.completed_at, iv.started_at) DESC LIMIT 6`,
  }));
  const pct = d.limits.interviews_per_month ? d.used / d.limits.interviews_per_month : 1;
  const steps = [
    { done: d.consent > 0, label: 'Write the consent notice', href: `/t/${slug}/consent`, admin: true },
    { done: d.banks > 0, label: 'Upload a question bank', href: `/t/${slug}/banks`, admin: true },
    { done: d.jobs.total > 0, label: 'Create a job and set its scoring', href: `/t/${slug}/jobs`, admin: true },
    { done: d.jobs.active > 0, label: 'Put a job live and invite candidates', href: `/t/${slug}/jobs`, admin: false },
  ];
  const setupDone = steps.every(s => s.done);
  const admin = ctx.can('manageSetup'), decide = ctx.can('manageCandidates');
  const intro = admin ? 'Your hiring at a glance. Set up jobs and question banks, then check results as candidates finish.'
    : decide ? 'Add candidates to a job, send their interview links, then review results as they come in.'
    : 'Listen to finished interviews and leave comments for the recruiters.';

  return (
    <>
      <PageHeader title="Home" description={intro}>
        <StatusBadge status={ctx.tenant.status} />
      </PageHeader>

      {d.toReview > 0 && (
        <Link href={`/t/${slug}/review`} className="mb-6 flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 hover:bg-amber-100/70">
          <span className="grid size-10 place-items-center rounded-xl bg-white text-amber-600 ring-1 ring-amber-200"><ClipboardCheck className="size-5" /></span>
          <span className="flex-1">
            <span className="block font-semibold text-amber-950">{d.toReview} {d.toReview === 1 ? 'interview is' : 'interviews are'} waiting for {decide ? 'your decision' : 'review'}</span>
            <span className="block text-sm text-amber-800">Listen to the answers and {decide ? 'shortlist, hold or reject' : 'leave a comment'}.</span>
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-900">Start reviewing <ArrowRight className="size-4" /></span>
        </Link>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Interviews this month" value={d.used.toLocaleString('en-IN')} progress={pct} icon={<Mic className="size-4.5" />}
                  sub={pct >= 1 ? 'Limit reached: new invites are blocked' : `of ${d.limits.interviews_per_month.toLocaleString('en-IN')} on your plan`} />
        <StatCard label="Finished interviews" value={d.stats.completed} icon={<CheckCircle2 className="size-4.5" />} tone="emerald" sub="All time, all jobs" />
        <StatCard label="Average score" value={d.stats.avg_score ?? '—'} icon={<Gauge className="size-4.5" />} tone="sky" sub="Out of 100, across finished interviews" />
        <StatCard label="Waiting for a decision" value={d.toReview} icon={<ClipboardCheck className="size-4.5" />} tone={d.toReview ? 'amber' : 'emerald'}
                  href={`/t/${slug}/review`} sub={d.stats.review ? `${d.stats.review} flagged to check first` : 'Click to see the list'} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="font-semibold text-slate-900">Recent interviews</h2>
            <Link href={`/t/${slug}/jobs`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">All jobs <ArrowRight className="size-3.5" /></Link>
          </div>
          {d.recent.length === 0 ? <p className="px-6 py-10 text-center text-sm text-slate-500">No interviews yet. Invite candidates from a job.</p> : (
            <ul className="divide-y divide-slate-100">
              {d.recent.map(r => {
                const [label, style] = r.status === 'completed' ? (SCORE_STATUS[r.score_status] ?? [r.score_status, '']) : ['In progress', 'text-slate-600 bg-slate-50 ring-slate-500/20'];
                return (
                  <li key={r.id}>
                    <Link href={`/t/${slug}/interviews/${r.id}`} className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50/70">
                      <Avatar name={r.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900">{r.name}</p>
                        <p className="truncate text-xs text-slate-500">{r.title} · {languageName(r.language)} · {new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                      </div>
                      <span className={`hidden rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset sm:inline ${style}`}>{label}</span>
                      <span className="w-12 text-right text-lg font-semibold tabular-nums text-slate-900">{r.final_score != null ? Math.round(Number(r.final_score)) : '—'}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div>
          <Section title="Live jobs" description={d.liveJobs.length ? 'Open one to add candidates or see results.' : 'No job is live yet.'}>
            {d.liveJobs.length === 0 ? (
              <p className="text-sm text-slate-500">{admin ? <Link href={`/t/${slug}/jobs`} className="font-medium text-brand-700 hover:underline">Create or open a job</Link> : 'Ask your HR admin to put a job live.'}</p>
            ) : (
              <ul className="-my-1 space-y-1">
                {d.liveJobs.map(j => (
                  <li key={j.id}>
                    <Link href={jobHome(slug, j as never)} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <Briefcase className="size-4 text-slate-400" /><span className="flex-1 truncate font-medium text-slate-800">{j.title}</span>
                      <span className="text-xs text-slate-500">{j.completed} finished</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {admin && (!setupDone || d.jobs.total < 2) && <Section title={setupDone ? 'Set-up complete' : 'Get set up'} description={setupDone ? 'Everything is ready for interviews.' : `${steps.filter(s => s.done).length} of ${steps.length} done`}>
            <ol className="space-y-3">
              {steps.map(s => (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  {s.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-500" /> : <Circle className="size-5 shrink-0 text-slate-300" />}
                  {ctx.can(s.admin ? 'manageSetup' : 'manageCandidates') && !s.done
                    ? <Link href={s.href} className="font-medium text-brand-700 hover:underline">{s.label}</Link>
                    : <span className={s.done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-700'}>{s.label}</span>}
                </li>
              ))}
            </ol>
          </Section>}
          {admin && <Section title="Your plan" description={`Languages: ${d.limits.languages.map(languageName).join(', ')}`}>
            <dl className="space-y-2 text-sm">
              {[
                ['Active jobs', `${d.jobs.active} of ${d.limits.concurrent_jobs}`, Briefcase],
                ['Recruiter seats', d.limits.recruiter_seats, null],
                ['AI budget', `₹${d.limits.ai_budget_inr.toLocaleString('en-IN')} / month`, null],
                ['Data kept', `${d.limits.retention_days} days`, null],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><dt className="text-slate-500">{k as string}</dt><dd className="font-medium text-slate-800">{v as string}</dd></div>
              ))}
            </dl>
          </Section>}
        </div>
      </div>
    </>
  );
}
