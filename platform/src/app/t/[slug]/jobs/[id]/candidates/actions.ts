'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { firstName, normalisePhone, readCandidates, type RowProblem } from '@/lib/candidates';
import { randomToken, sha256 } from '@/lib/crypto';
import { invitesThisMonth, tenantAction, tenantLimits, type TenantContext } from '@/lib/tenant';
import type { Tx } from '@/db';

export type ImportState =
  | { status: 'idle' }
  | { status: 'done'; added: number; duplicates: number; problems: RowProblem[] }
  | { status: 'error'; message: string };

const MAX_CSV_BYTES = 2 * 1024 * 1024;

export async function importCandidates(slug: string, jobId: string, _prev: ImportState, form: FormData): Promise<ImportState> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: 'Choose a CSV file.' };
  if (file.size > MAX_CSV_BYTES) return { status: 'error', message: 'The file is larger than 2 MB.' };
  if (!/\.csv$/i.test(file.name)) return { status: 'error', message: 'Upload a .csv file (in Excel: File → Save As → CSV UTF-8).' };
  try {
    return await tenantAction(slug, 'manageCandidates', async (tx, ctx, log) => {
      const [job] = await tx`SELECT languages, status FROM jobs WHERE id = ${jobId}`;
      if (!job) return { status: 'error', message: 'Job not found.' } as const;
      if (job.status === 'closed') return { status: 'error', message: 'This job is closed.' } as const;
      const { candidates, problems } = readCandidates(await file.text(), job.languages);
      let added = 0;
      for (const c of candidates) {
        const r = await tx`
          INSERT INTO candidates (tenant_id, job_id, name, phone, email, language, source, created_by)
          VALUES (${ctx.tenant.id}, ${jobId}, ${c.name}, ${c.phone}, ${c.email}, ${c.language}, 'import', ${ctx.user.id})
          ON CONFLICT DO NOTHING RETURNING id`;
        added += r.length;
      }
      await log({ action: 'candidates.imported', target: jobId, details: { file: file.name, added, duplicates: candidates.length - added, skipped: problems.length } });
      return { status: 'done', added, duplicates: candidates.length - added, problems } as const;
    });
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  } finally {
    revalidatePath(`/t/${slug}/jobs/${jobId}/candidates`);
  }
}

export async function addCandidate(slug: string, jobId: string, form: FormData) {
  const name = String(form.get('name') ?? '').trim();
  const rawPhone = String(form.get('phone') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase() || null;
  const phone = rawPhone ? normalisePhone(rawPhone) : null;
  const back = (q: string) => redirect(`/t/${slug}/jobs/${jobId}/candidates?${q}`);
  if (!name || (rawPhone && !phone) || (!phone && !email) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) back('error=candidate');
  const result = await tenantAction(slug, 'manageCandidates', async (tx, ctx, log) => {
    const [job] = await tx`SELECT languages FROM jobs WHERE id = ${jobId} AND status <> 'closed'`;
    if (!job) return 'closed';
    const language = (job.languages as string[]).includes(String(form.get('language'))) ? String(form.get('language')) : null;
    const [c] = await tx`
      INSERT INTO candidates (tenant_id, job_id, name, phone, email, language, source, created_by)
      VALUES (${ctx.tenant.id}, ${jobId}, ${name}, ${phone}, ${email}, ${language}, 'manual', ${ctx.user.id})
      ON CONFLICT DO NOTHING RETURNING id`;
    if (!c) return 'duplicate';
    await log({ action: 'candidate.added', target: c.id });
    return 'ok';
  });
  back(result === 'ok' ? 'msg=added' : `error=${result}`);
}

/** Creates an invitation and queues the SMS / email. Caller has checked the job is active and the limit. */
async function invite(tx: Tx, ctx: TenantContext, job: InviteJob, c: { id: string; name: string; phone: string | null; email: string | null }) {
  const token = randomToken();
  await tx`UPDATE invitations SET status = 'revoked' WHERE candidate_id = ${c.id} AND status IN ('pending', 'opened')`;
  const [inv] = await tx`
    INSERT INTO invitations (tenant_id, candidate_id, token_hash, expires_at, created_by)
    VALUES (${ctx.tenant.id}, ${c.id}, ${sha256(token)}, now() + make_interval(days => ${job.invite_valid_days}), ${ctx.user.id})
    RETURNING expires_at`;
  const link = `${process.env.APP_URL}/i/${token}`;
  const until = new Date(inv.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const first = firstName(c.name);
  if (c.phone) {
    await tx`INSERT INTO outbox (tenant_id, template, channel, to_address, body) VALUES (${ctx.tenant.id}, 'invite', 'sms', ${c.phone},
             ${`Hi ${first}, ${ctx.tenant.name} invites you to a 15-minute voice interview for ${job.title} on your phone: ${link} Valid till ${until}.`})`;
  }
  if (c.email) {
    await tx`INSERT INTO outbox (tenant_id, template, channel, to_address, subject, body) VALUES (${ctx.tenant.id}, 'invite', 'email', ${c.email},
             ${`Your voice interview for ${job.title} – ${ctx.tenant.name}`},
             ${`Hi ${first},\n\nThank you for applying for ${job.title} at ${ctx.tenant.name}.\n\nThe next step is a short voice interview (about 15 minutes) that you can take on your phone, whenever suits you before ${until}:\n\n${link}\n\nYou'll hear each question and record your answer. Find a quiet place and make sure your phone's microphone works.\n\nThis link is personal to you; please don't share it. To see your data or withdraw consent at any time: ${link}/privacy\n\n${ctx.tenant.name}`})`;
  }
  return link;
}

type InviteJob = { id: string; title: string; invite_valid_days: number };

async function checkCanInvite(tx: Tx, ctx: TenantContext, jobId: string, count: number): Promise<{ error: 'job_inactive' | 'limit' } | { job: InviteJob }> {
  const [job] = await tx`SELECT id, title, status, invite_valid_days FROM jobs WHERE id = ${jobId}`;
  if (!job || job.status !== 'active') return { error: 'job_inactive' };
  const { interviews_per_month } = await tenantLimits(tx, ctx.tenant.id);
  if ((await invitesThisMonth(tx)) + count > interviews_per_month) return { error: 'limit' };
  return { job: job as unknown as InviteJob };
}

const INVITE_ERRORS = {
  job_inactive: 'Activate the job before inviting candidates.',
  limit: 'This month’s interview limit is reached. New invites are blocked until next month or until the platform administrator raises the limit.',
};

/** Invite one candidate; returns the link once so the recruiter can also share it directly. */
export async function inviteOne(slug: string, jobId: string, candidateId: string): Promise<{ link: string } | { error: string }> {
  try {
    const r = await tenantAction(slug, 'manageCandidates', async (tx, ctx, log) => {
      const check = await checkCanInvite(tx, ctx, jobId, 1);
      if ('error' in check) return { error: INVITE_ERRORS[check.error] };
      const [c] = await tx`SELECT id, name, phone, email FROM candidates WHERE id = ${candidateId} AND job_id = ${jobId}`;
      if (!c) return { error: 'Candidate not found.' };
      const link = await invite(tx, ctx, check.job, c as never);
      await log({ action: 'candidate.invited', target: candidateId });
      return { link };
    });
    revalidatePath(`/t/${slug}/jobs/${jobId}/candidates`);
    return r;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function inviteAllNew(slug: string, jobId: string) {
  const result = await tenantAction(slug, 'manageCandidates', async (tx, ctx, log): Promise<string> => {
    const pending = await tx`SELECT id, name, phone, email FROM candidates c WHERE job_id = ${jobId}
                             AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.candidate_id = c.id)`;
    if (!pending.length) return 'none';
    const check = await checkCanInvite(tx, ctx, jobId, pending.length);
    if ('error' in check) return check.error;
    for (const c of pending) await invite(tx, ctx, check.job, c as never);
    await log({ action: 'candidates.invited_bulk', target: jobId, details: { count: pending.length } });
    return `invited_${pending.length}`;
  });
  redirect(`/t/${slug}/jobs/${jobId}/candidates?${result.startsWith('invited_') ? `msg=invited&n=${result.slice(8)}` : `error=${result}`}`);
}

export async function revokeInvite(slug: string, jobId: string, candidateId: string) {
  await tenantAction(slug, 'manageCandidates', async (tx, _ctx, log) => {
    const r = await tx`UPDATE invitations SET status = 'revoked' WHERE candidate_id = ${candidateId} AND status IN ('pending', 'opened') RETURNING id`;
    if (r.length) await log({ action: 'candidate.invite_revoked', target: candidateId });
  });
  revalidatePath(`/t/${slug}/jobs/${jobId}/candidates`);
}
