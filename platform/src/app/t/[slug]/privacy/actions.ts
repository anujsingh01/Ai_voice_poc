'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { deleteCandidates, removeFiles } from '@/lib/retention';
import { tenantAction } from '@/lib/tenant';

export async function closeRequest(slug: string, requestId: number, form: FormData) {
  const resolution = String(form.get('resolution') ?? '').trim();
  if (resolution.length < 3) redirect(`/t/${slug}/privacy?error=resolution`);
  await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
    await tx`UPDATE rights_requests SET status = 'closed', resolution = ${resolution.slice(0, 2000)}, handled_by = ${ctx.user.id}, closed_at = now()
             WHERE id = ${requestId} AND status <> 'closed'`;
    await log({ action: 'rights.closed', target: String(requestId) });
  });
  revalidatePath(`/t/${slug}/privacy`);
  redirect(`/t/${slug}/privacy?msg=closed`);
}

/** Deletes the candidate's data now (for a deletion request) and closes the request. */
export async function deleteForRequest(slug: string, requestId: number) {
  const keys = await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
    const [r] = await tx`SELECT candidate_id FROM rights_requests WHERE id = ${requestId}`;
    if (!r?.candidate_id) return [];
    const res = await deleteCandidates(tx, ctx.tenant.id, [r.candidate_id], 'request', ctx.user.id);
    await tx`UPDATE rights_requests SET status = 'closed', resolution = 'All interview data deleted.', handled_by = ${ctx.user.id}, closed_at = now()
             WHERE id = ${requestId}`;
    await log({ action: 'rights.deletion_completed', target: String(requestId) });
    return res.keys ?? [];
  });
  await removeFiles(keys);
  revalidatePath(`/t/${slug}/privacy`);
  redirect(`/t/${slug}/privacy?msg=deleted`);
}
