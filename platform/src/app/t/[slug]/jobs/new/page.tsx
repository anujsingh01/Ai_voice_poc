import { Button, Notice, PageHeader, Section, messageFor } from '@/components/ui';
import { inTenant, requireTenant, tenantLimits } from '@/lib/tenant';
import { createJob } from '../actions';
import { JobFields, NEW_JOB } from '../job-fields';

const ERRORS = { invalid: 'Check the title, at least one language, and the numbers.' };

export default async function NewJobPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, 'manageSetup');
  const { banks, limits } = await inTenant(ctx, async tx => ({
    banks: (await tx`SELECT id, name FROM question_banks ORDER BY name`) as unknown as { id: string; name: string }[],
    limits: await tenantLimits(tx, ctx.tenant.id),
  }));
  const err = messageFor((await searchParams).error, ERRORS);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New job" back={{ href: `/t/${slug}/jobs`, label: 'Jobs' }} />
      {err && <Notice>{err}</Notice>}
      <form action={createJob.bind(null, slug)}>
        <Section title="Job" description="New jobs start as drafts. You can set the scoring rubric after saving.">
          <JobFields job={NEW_JOB} banks={banks} tenantLanguages={limits.languages} />
        </Section>
        <Button>Create job</Button>
      </form>
    </div>
  );
}
