'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DEFAULT_CUTOFF, DEFAULT_DIMENSIONS, type Dimension } from '@/lib/rubric';
import { tenantAction, tenantLimits } from '@/lib/tenant';
import { activationProblems } from '@/lib/jobs';

const jobSchema = z.object({
  title: z.string().trim().min(2).max(120),
  location: z.string().trim().max(120).optional().transform(v => v || null),
  description: z.string().trim().max(4000).optional().transform(v => v || null),
  bank_id: z.string().uuid().optional().or(z.literal('')).transform(v => v || null),
  questions_per_interview: z.coerce.number().int().min(1).max(20),
  objections_per_interview: z.coerce.number().int().min(0).max(10),
  answer_seconds: z.coerce.number().int().min(30).max(300),
  invite_valid_days: z.coerce.number().int().min(1).max(30),
  languages: z.array(z.string()).min(1),
});

function readJob(form: FormData) {
  return jobSchema.safeParse({ ...Object.fromEntries(form), languages: form.getAll('languages') });
}

export async function createJob(slug: string, form: FormData) {
  const j = readJob(form);
  if (!j.success) redirect(`/t/${slug}/jobs/new?error=invalid`);
  const id = await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
    const { languages } = await tenantLimits(tx, ctx.tenant.id);
    const langs = j.data.languages.filter(l => languages.includes(l));
    if (!langs.length) return null;
    const d = j.data;
    const [job] = await tx`
      INSERT INTO jobs (tenant_id, title, location, description, bank_id, languages, questions_per_interview,
                        objections_per_interview, answer_seconds, invite_valid_days, created_by)
      VALUES (${ctx.tenant.id}, ${d.title}, ${d.location}, ${d.description}, ${d.bank_id}, ${langs}, ${d.questions_per_interview},
              ${d.objections_per_interview}, ${d.answer_seconds}, ${d.invite_valid_days}, ${ctx.user.id})
      RETURNING id`;
    await tx`INSERT INTO rubrics (tenant_id, job_id, version, dimensions, shortlist_cutoff, created_by)
             VALUES (${ctx.tenant.id}, ${job.id}, 1, ${tx.json(DEFAULT_DIMENSIONS)}, ${DEFAULT_CUTOFF}, ${ctx.user.id})`;
    await log({ action: 'job.created', target: job.id, details: { title: d.title } });
    return job.id as string;
  });
  if (!id) redirect(`/t/${slug}/jobs/new?error=invalid`);
  redirect(`/t/${slug}/jobs/${id}?msg=created`);
}

export async function updateJob(slug: string, jobId: string, form: FormData) {
  const j = readJob(form);
  if (!j.success) redirect(`/t/${slug}/jobs/${jobId}?error=invalid`);
  await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
    const { languages } = await tenantLimits(tx, ctx.tenant.id);
    const d = j.data;
    const langs = d.languages.filter(l => languages.includes(l));
    await tx`
      UPDATE jobs SET title = ${d.title}, location = ${d.location}, description = ${d.description}, bank_id = ${d.bank_id},
        languages = ${langs}, questions_per_interview = ${d.questions_per_interview},
        objections_per_interview = ${d.objections_per_interview}, answer_seconds = ${d.answer_seconds},
        invite_valid_days = ${d.invite_valid_days}, updated_at = now()
      WHERE id = ${jobId}`;
    await log({ action: 'job.updated', target: jobId, details: d });
  });
  revalidatePath(`/t/${slug}/jobs/${jobId}`);
  redirect(`/t/${slug}/jobs/${jobId}?msg=saved`);
}

export async function setJobStatus(slug: string, jobId: string, status: 'draft' | 'active' | 'closed') {
  const result = await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
    if (status === 'active') {
      if ((await activationProblems(tx, jobId)).length) return 'not_ready';
      const { concurrent_jobs } = await tenantLimits(tx, ctx.tenant.id);
      const [{ n }] = await tx`SELECT count(*)::int AS n FROM jobs WHERE status = 'active' AND id <> ${jobId}`;
      if (n >= concurrent_jobs) return 'job_limit';
    }
    await tx`UPDATE jobs SET status = ${status}, updated_at = now() WHERE id = ${jobId}`;
    await log({ action: `job.${status === 'active' ? 'activated' : status === 'closed' ? 'closed' : 'moved_to_draft'}`, target: jobId });
    return 'ok';
  });
  revalidatePath(`/t/${slug}/jobs/${jobId}`);
  redirect(`/t/${slug}/jobs/${jobId}?${result === 'ok' ? `msg=${status}` : `error=${result}`}`);
}

export async function saveRubric(slug: string, jobId: string, form: FormData) {
  const dims: Dimension[] = DEFAULT_DIMENSIONS.map(d => ({ ...d, weight: Number(form.get(`w_${d.key}`)) }));
  const cutoff = Number(form.get('cutoff'));
  const valid = dims.every(d => Number.isInteger(d.weight) && d.weight >= 0 && d.weight <= 100)
    && dims.reduce((s, d) => s + d.weight, 0) === 100 && Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 100;
  if (!valid) redirect(`/t/${slug}/jobs/${jobId}?error=rubric#rubric`);
  await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
    const [r] = await tx`
      INSERT INTO rubrics (tenant_id, job_id, version, dimensions, shortlist_cutoff, created_by)
      SELECT ${ctx.tenant.id}, ${jobId}, coalesce(max(version), 0) + 1, ${tx.json(dims)}, ${cutoff}, ${ctx.user.id}
      FROM rubrics WHERE job_id = ${jobId}
      RETURNING version`;
    await log({ action: 'rubric.saved', target: jobId, details: { version: r.version, dims, cutoff } });
  });
  revalidatePath(`/t/${slug}/jobs/${jobId}`);
  redirect(`/t/${slug}/jobs/${jobId}?msg=rubric#rubric`);
}
