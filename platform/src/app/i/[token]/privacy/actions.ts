'use server';

import { redirect } from 'next/navigation';
import { sql, withContext } from '@/db';
import { clientInfo } from '@/lib/auth';
import { sha256 } from '@/lib/crypto';
import { allowAttempt } from '@/lib/rate-limit';

const KINDS = ['access', 'correction', 'deletion', 'withdraw', 'complaint'] as const;
const RESPONSE_DAYS = 30;

/** Masks contact details for the request record that outlives the candidate's data. */
const ref = (name: string, phone: string | null, email: string | null) =>
  `${name} · ${phone ? phone.slice(0, 3) + '…' + phone.slice(-3) : (email ?? '').replace(/^(.).*(@.*)$/, '$1…$2')}`;

/**
 * A candidate exercises a right from their personal link. Withdrawing consent takes effect at once:
 * open invitations are revoked, processing stops, and the data is deleted by the next retention run.
 */
export async function submitRequest(token: string, form: FormData) {
  const kind = String(form.get('kind'));
  const details = String(form.get('details') ?? '').trim().slice(0, 2000) || null;
  const back = (q: string): never => redirect(`/i/${token}/privacy?${q}`);
  if (!/^[\w-]{20,64}$/.test(token) || !(KINDS as readonly string[]).includes(kind)) back('error=invalid');
  if (!(await allowAttempt('rights:' + sha256(token), 10, 3600))) back('error=rate');
  if ((kind === 'correction' || kind === 'complaint') && !details) back('error=details');

  const [inv] = await sql`SELECT * FROM invitation_by_token(${sha256(token)})`;
  if (!inv) back('error=invalid');
  const { ip } = await clientInfo();
  await withContext({ tenantId: inv.tenant_id }, async tx => {
    const [c] = await tx`SELECT c.id, c.name, c.phone, c.email FROM candidates c JOIN invitations i ON i.candidate_id = c.id WHERE i.id = ${inv.invitation_id}`;
    if (!c) return;
    const closed = kind === 'withdraw';
    await tx`INSERT INTO rights_requests (tenant_id, candidate_id, candidate_ref, kind, details, status, due_at, resolution, closed_at)
             VALUES (${inv.tenant_id}, ${c.id}, ${ref(c.name, c.phone, c.email)}, ${kind}, ${details}, ${closed ? 'closed' : 'open'},
                     now() + make_interval(days => ${RESPONSE_DAYS}), ${closed ? 'Consent withdrawn by the candidate; data scheduled for deletion.' : null},
                     ${closed ? new Date() : null})`;
    if (closed) {
      await tx`UPDATE consent_records SET withdrawn_at = now() WHERE candidate_id = ${c.id} AND withdrawn_at IS NULL`;
      await tx`UPDATE invitations SET status = 'revoked' WHERE candidate_id = ${c.id} AND status IN ('pending', 'opened')`;
      await tx`UPDATE interviews SET status = 'abandoned' WHERE candidate_id = ${c.id} AND status = 'in_progress'`;
      await tx`UPDATE candidates SET delete_after = now() WHERE id = ${c.id}`;
    }
    await tx`INSERT INTO audit_log (tenant_id, action, target, ip) VALUES (${inv.tenant_id}, ${`rights.${kind}_requested`}, ${c.id}, ${ip})`;
  });
  back(`msg=${kind}`);
}
