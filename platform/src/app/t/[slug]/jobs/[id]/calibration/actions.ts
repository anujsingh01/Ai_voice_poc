'use server';

import { redirect } from 'next/navigation';
import type { Dimension } from '@/lib/rubric';
import { tenantAction } from '@/lib/tenant';

/** Saves (or updates) this recruiter's blind rating, then opens the next interview they haven't rated. */
export async function saveRating(slug: string, jobId: string, interviewId: string, form: FormData) {
  const next = await tenantAction(slug, 'manageCandidates', async (tx, ctx, log) => {
    const [iv] = await tx`SELECT r.dimensions FROM interviews iv JOIN rubrics r ON r.id = iv.rubric_id WHERE iv.id = ${interviewId} AND iv.job_id = ${jobId}`;
    if (!iv) return 'invalid';
    const dims: Record<string, number> = {};
    for (const d of iv.dimensions as Dimension[]) {
      const v = Number(form.get(`d_${d.key}`));
      if (!Number.isInteger(v) || v < 1 || v > 5) return 'incomplete';
      dims[d.key] = v;
    }
    const shortlist = form.get('shortlist');
    if (shortlist !== 'yes' && shortlist !== 'no') return 'incomplete';
    const notes = String(form.get('notes') ?? '').trim().slice(0, 2000) || null;
    await tx`INSERT INTO calibration_ratings (tenant_id, interview_id, rater_id, dimensions, shortlist, notes)
             VALUES (${ctx.tenant.id}, ${interviewId}, ${ctx.user.id}, ${tx.json(dims)}, ${shortlist === 'yes'}, ${notes})
             ON CONFLICT (interview_id, rater_id) DO UPDATE SET dimensions = EXCLUDED.dimensions, shortlist = EXCLUDED.shortlist, notes = EXCLUDED.notes, created_at = now()`;
    await log({ action: 'calibration.rated', target: interviewId });
    const [n] = await tx`
      SELECT iv.id FROM interviews iv
      WHERE iv.job_id = ${jobId} AND iv.status = 'completed' AND iv.final_score IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM calibration_ratings cr WHERE cr.interview_id = iv.id AND cr.rater_id = ${ctx.user.id})
      ORDER BY random() LIMIT 1`;
    return n ? `next:${n.id}` : 'done';
  });
  const base = `/t/${slug}/jobs/${jobId}/calibration`;
  if (next.startsWith('next:')) redirect(`${base}/${next.slice(5)}?msg=saved`);
  redirect(next === 'done' ? `${base}?msg=done` : `${base}/${interviewId}?error=${next}`);
}
