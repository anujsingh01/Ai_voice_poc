import { Briefcase, ChevronRight, MapPin, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { Card, EmptyState, LinkAsButton, PageHeader, StatusBadge } from '@/components/ui';
import { languageName } from '@/lib/languages';
import { inTenant, requireTenant, tenantLimits } from '@/lib/tenant';
import { jobHome } from './[id]/job-header';

export default async function JobsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const { jobs, limits } = await inTenant(ctx, async tx => ({
    jobs: await tx`
      SELECT j.id, j.title, j.location, j.status, j.languages, b.name AS bank,
             (SELECT count(*) FROM candidates c WHERE c.job_id = j.id)::int AS candidates,
             (SELECT count(*) FROM interviews iv WHERE iv.job_id = j.id AND iv.status = 'completed')::int AS completed,
             (SELECT round(avg(final_score))::int FROM interviews iv WHERE iv.job_id = j.id) AS avg_score
      FROM jobs j LEFT JOIN question_banks b ON b.id = j.bank_id
      ORDER BY (j.status = 'active') DESC, j.created_at DESC`,
    limits: await tenantLimits(tx, ctx.tenant.id),
  }));
  const active = jobs.filter(j => j.status === 'active').length;
  return (
    <>
      <PageHeader title="Jobs & candidates" description={`Open a job to add candidates, send interview links and see results. ${active} of ${limits.concurrent_jobs} live jobs used on your plan.`}
                  actions={ctx.can('manageSetup') && <LinkAsButton href={`/t/${slug}/jobs/new`}><Plus className="size-4" /> New job</LinkAsButton>} />
      {jobs.length === 0 ? <EmptyState icon={<Briefcase className="size-5" />}>No jobs yet. Create one to start inviting candidates.</EmptyState> : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {jobs.map(j => (
              <li key={j.id}>
                <Link href={jobHome(slug, j as never)} className="group flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 hover:bg-slate-50/70">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><Briefcase className="size-4.5" /></span>
                  <div className="min-w-48 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900 group-hover:text-brand-700">{j.title}</p>
                      <StatusBadge status={j.status} />
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                      {j.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{j.location}</span>}
                      <span>{(j.languages as string[]).map(languageName).join(', ')}</span>
                      <span>{j.bank ?? 'No question bank yet'}</span>
                    </p>
                  </div>
                  <div className="flex gap-8 text-sm">
                    <div><p className="text-xs text-slate-500">Candidates</p><p className="font-semibold tabular-nums text-slate-900"><Users className="mr-1 inline size-3.5 text-slate-400" />{j.candidates}</p></div>
                    <div><p className="text-xs text-slate-500">Interviewed</p><p className="font-semibold tabular-nums text-slate-900">{j.completed}</p></div>
                    <div><p className="text-xs text-slate-500">Average score</p><p className="font-semibold tabular-nums text-slate-900">{j.avg_score ?? '—'}</p></div>
                  </div>
                  <ChevronRight className="size-4 text-slate-300 group-hover:text-slate-500" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
