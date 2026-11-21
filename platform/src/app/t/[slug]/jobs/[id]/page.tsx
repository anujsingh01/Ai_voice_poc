import { notFound } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Rocket } from 'lucide-react';
import { Button, Notice, Section, messageFor } from '@/components/ui';
import { JobHeader } from './job-header';
import { RubricEditor } from './rubric-editor';
import { activationProblems } from '@/lib/jobs';
import type { Dimension } from '@/lib/rubric';
import { inTenant, requireTenant, tenantLimits } from '@/lib/tenant';
import { saveRubric, setJobStatus, updateJob } from '../actions';
import { JobFields, type JobValues } from '../job-fields';

const MESSAGES = {
  created: 'Job created as a draft. Check how the score is worked out below, then press Go live when ready.',
  saved: 'Saved.', rubric: 'Scoring weights saved. Interviews already scored keep the weights they were scored with.',
  active: 'Job is live. Go to the Candidates tab to add people and send them their interview link.', closed: 'Job closed. No new interviews can start.', draft: 'Job moved back to draft.',
};
const ERRORS = {
  invalid: 'Check the title, at least one language, and the numbers.',
  rubric: 'Weights must be whole numbers that add up to exactly 100, and the cut-off must be 0–100.',
  not_ready: 'The job isn’t ready to go live yet; see what’s missing on the right.',
  job_limit: 'You already have the maximum number of active jobs. Close one first, or ask the platform administrator to raise the limit.',
};

export default async function JobPage({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant(slug);
  const data = await inTenant(ctx, async tx => {
    const [job] = await tx`SELECT * FROM jobs WHERE id = ${id}`;
    if (!job) return null;
    return {
      job,
      banks: (await tx`SELECT id, name FROM question_banks ORDER BY name`) as unknown as { id: string; name: string }[],
      limits: await tenantLimits(tx, ctx.tenant.id),
      rubric: (await tx`SELECT * FROM rubrics WHERE job_id = ${id} ORDER BY version DESC LIMIT 1`)[0],
      problems: await activationProblems(tx, id),
      candidates: (await tx`SELECT count(*)::int AS n FROM candidates WHERE job_id = ${id}`)[0].n as number,
    };
  });
  if (!data) notFound();
  const { job, banks, limits, rubric, problems, candidates } = data;
  const { msg, error } = await searchParams;
  const note = messageFor(msg, MESSAGES), err = messageFor(error, ERRORS);
  const edit = ctx.can('manageSetup');
  const dims = rubric.dimensions as Dimension[];

  const ready = problems.length === 0;
  return (
    <>
      <JobHeader slug={slug} job={job as never} tab="settings" counts={{ candidates }}
                 description="What candidates see, which questions they get, and how their answers are scored." />
      {note && <Notice kind="success">{note}</Notice>}
      {err && <Notice>{err}</Notice>}

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0">
          <Section title="Interview settings" description="Questions are picked at random from the question bank for each candidate. Customer objections are short role-plays, such as “your price is too high”.">
            <form action={updateJob.bind(null, slug, id)}>
              <JobFields job={job as unknown as JobValues} banks={banks} tenantLanguages={limits.languages} disabled={!edit} />
              {edit && <Button>Save settings</Button>}
            </form>
          </Section>
          <div id="rubric" />
          <Section title="How the score is worked out" description="Each answer is marked on these six qualities. Set how much each one counts; together they make the 0–100 score. Accent, grammar and language choice are never scored.">
            <RubricEditor dims={dims} cutoff={rubric.shortlist_cutoff} action={saveRubric.bind(null, slug, id)} disabled={!edit} />
            <p className="mt-4 text-xs text-slate-500">
              Must-pass questions (for example “willing to do field work”) are marked in the Excel question bank.
              A candidate who doesn’t meet one is flagged for a person to check; nobody is rejected automatically.
            </p>
          </Section>
        </div>

        <div className="xl:sticky xl:top-8">
          <Section title="Job status">
            {job.status === 'active' ? (
              <p className="mb-4 flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" /> Live: you can invite candidates.</p>
            ) : ready ? (
              <p className="mb-4 flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" /> Ready to go live.</p>
            ) : (
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-slate-700">Before this job can go live:</p>
                <ul className="space-y-2">
                  {problems.map(p => <li key={p} className="flex gap-2 text-sm text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />{p}</li>)}
                </ul>
              </div>
            )}
            {edit ? (
              <div className="flex flex-wrap gap-2">
                {job.status !== 'active' && (
                  <form action={setJobStatus.bind(null, slug, id, 'active')}><Button disabled={!ready}><Rocket className="size-4" /> Go live</Button></form>
                )}
                {job.status === 'active' && (
                  <form action={setJobStatus.bind(null, slug, id, 'closed')}><Button variant="secondary" title="Stops new interviews. Results stay.">Close job</Button></form>
                )}
                {job.status !== 'draft' && (
                  <form action={setJobStatus.bind(null, slug, id, 'draft')}><Button variant="ghost" title="Takes it off live so you can change it.">Move back to draft</Button></form>
                )}
              </div>
            ) : <p className="text-sm text-slate-500">Only HR admins can change the job status.</p>}
          </Section>
        </div>
      </div>
    </>
  );
}
