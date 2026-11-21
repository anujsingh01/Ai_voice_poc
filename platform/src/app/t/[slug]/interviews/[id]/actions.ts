'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { tenantAction } from '@/lib/tenant';

function back(slug: string, id: string, q: string): never {
  redirect(`/t/${slug}/interviews/${id}?${q}#decide`);
}

/** Shortlist / hold / reject, always with a reason. A new row each time, so the history stays. */
export async function decide(slug: string, interviewId: string, form: FormData) {
  const d = z.object({ decision: z.enum(['shortlist', 'hold', 'reject']), reason: z.string().trim().min(3).max(2000) })
    .safeParse({ decision: form.get('decision'), reason: form.get('reason') });
  if (!d.success) back(slug, interviewId, 'error=decision');
  const ok = await tenantAction(slug, 'manageCandidates', async (tx, ctx, log) => {
    const [iv] = await tx`SELECT id FROM interviews WHERE id = ${interviewId} AND status = 'completed'`;
    if (!iv) return false;
    await tx`INSERT INTO decisions (tenant_id, interview_id, decision, reason, decided_by)
             VALUES (${ctx.tenant.id}, ${interviewId}, ${d.data.decision}, ${d.data.reason}, ${ctx.user.id})`;
    await log({ action: `decision.${d.data.decision}`, target: interviewId, details: { reason: d.data.reason } });
    return true;
  });
  revalidatePath(`/t/${slug}/interviews/${interviewId}`);
  back(slug, interviewId, ok ? 'msg=decided' : 'error=not_completed');
}

/** Replaces the AI total with a recruiter's score; the AI score is kept alongside for calibration. */
export async function overrideScore(slug: string, interviewId: string, form: FormData) {
  const d = z.object({ score: z.coerce.number().min(0).max(100), reason: z.string().trim().min(10).max(2000) })
    .safeParse({ score: form.get('score'), reason: form.get('reason') });
  if (!d.success) back(slug, interviewId, 'error=override');
  const ok = await tenantAction(slug, 'manageCandidates', async (tx, ctx, log) => {
    const [iv] = await tx`SELECT final_score FROM interviews WHERE id = ${interviewId} AND status = 'completed'`;
    if (!iv) return false;
    await tx`INSERT INTO score_overrides (tenant_id, interview_id, ai_score, new_score, reason, overridden_by)
             VALUES (${ctx.tenant.id}, ${interviewId}, ${iv.final_score}, ${d.data.score}, ${d.data.reason}, ${ctx.user.id})`;
    await log({ action: 'score.overridden', target: interviewId, details: { ai: iv.final_score, new: d.data.score, reason: d.data.reason } });
    return true;
  });
  revalidatePath(`/t/${slug}/interviews/${interviewId}`);
  back(slug, interviewId, ok ? 'msg=overridden' : 'error=not_completed');
}

export async function addComment(slug: string, interviewId: string, form: FormData) {
  const body = String(form.get('body') ?? '').trim();
  const position = Number(form.get('position')) || null;
  if (!body || body.length > 2000) redirect(`/t/${slug}/interviews/${interviewId}?error=comment#comments`);
  await tenantAction(slug, 'comment', async (tx, ctx, log) => {
    const [iv] = await tx`SELECT 1 FROM interviews WHERE id = ${interviewId}`;
    if (!iv) return;
    await tx`INSERT INTO comments (tenant_id, interview_id, position, body, author_id) VALUES (${ctx.tenant.id}, ${interviewId}, ${position}, ${body}, ${ctx.user.id})`;
    await log({ action: 'comment.added', target: interviewId });
  });
  revalidatePath(`/t/${slug}/interviews/${interviewId}`);
  redirect(`/t/${slug}/interviews/${interviewId}#comments`);
}
