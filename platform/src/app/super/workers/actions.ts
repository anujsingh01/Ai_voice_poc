'use server';

import { revalidatePath } from 'next/cache';
import { withContext } from '@/db';
import { audit } from '@/lib/audit';
import { clientInfo } from '@/lib/auth';
import { requirePlatform } from '@/lib/platform';
import { randomToken, sha256 } from '@/lib/crypto';

export type NewWorkerState = { status: 'idle' } | { status: 'created'; name: string; token: string } | { status: 'error'; message: string };

/** Registers a transcription PC. Its token is shown once; only a hash is stored. */
export async function createWorker(_prev: NewWorkerState, form: FormData): Promise<NewWorkerState> {
  const { user } = await requirePlatform('manageWorkers');
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 80) return { status: 'error', message: 'Give the PC a name (2–80 characters), e.g. “Office GPU 1”.' };
  const token = 'wk_' + randomToken();
  await withContext({ superAdmin: true }, async tx => {
    const [w] = await tx`INSERT INTO workers (name, token_hash) VALUES (${name}, ${sha256(token)}) RETURNING id`;
    await audit(tx, { actorUserId: user.id, action: 'worker.created', target: w.id, details: { name }, ip: (await clientInfo()).ip });
  });
  revalidatePath('/super/workers');
  return { status: 'created', name, token };
}

export async function setWorkerDisabled(id: string, disabled: boolean) {
  const { user } = await requirePlatform('manageWorkers');
  await withContext({ superAdmin: true }, async tx => {
    await tx`UPDATE workers SET disabled = ${disabled} WHERE id = ${id}`;
    // Give its leased jobs back to the queue immediately.
    if (disabled) await tx`UPDATE transcription_jobs SET status = 'queued', leased_until = NULL WHERE worker_id = ${id} AND status = 'leased'`;
    await audit(tx, { actorUserId: user.id, action: disabled ? 'worker.disabled' : 'worker.enabled', target: id, ip: (await clientInfo()).ip });
  });
  revalidatePath('/super/workers');
}

export async function retryFailedJobs() {
  const { user } = await requirePlatform('manageWorkers');
  await withContext({ superAdmin: true }, async tx => {
    const r = await tx`UPDATE transcription_jobs SET status = 'queued', attempts = 0, error = NULL, finished_at = NULL WHERE status = 'failed' RETURNING id`;
    await audit(tx, { actorUserId: user.id, action: 'transcription.retried_failed', details: { count: r.length }, ip: (await clientInfo()).ip });
  });
  revalidatePath('/super/workers');
}
