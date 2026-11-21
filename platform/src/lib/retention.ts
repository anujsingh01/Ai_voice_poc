import { withContext, type Tx } from '@/db';
import { firstName } from './candidates';
import { deleteObject } from './storage';

// Data retention (DPDP Rule 8): each completed interview is deleted when the tenant's retention period
// ends, with a 48-hour notice to the candidate first. Withdrawn consent and deletion requests delete
// straight away. What remains afterwards: an audit entry and a count in deletion_log, no personal data.

export const NOTICE_HOURS = 48;

/** Deletes candidates and everything about them (answers, transcripts, scores, decisions, files). */
export async function deleteCandidates(tx: Tx, tenantId: string, candidateIds: string[], reason: string, actorUserId: string | null) {
  if (!candidateIds.length) return { candidates: 0, files: 0 };
  const files = (await tx`
    SELECT a.storage_key FROM answers a JOIN interview_questions iq ON iq.id = a.interview_question_id
    JOIN interviews iv ON iv.id = iq.interview_id WHERE iv.candidate_id IN ${tx(candidateIds)}`).map(r => r.storage_key as string);
  // Rights requests keep a reference ("Priya R., +91…210") but lose the link to the deleted record.
  const deleted = await tx`DELETE FROM candidates WHERE id IN ${tx(candidateIds)} AND tenant_id = ${tenantId} RETURNING id`;
  await tx`INSERT INTO deletion_log (tenant_id, reason, candidates, files) VALUES (${tenantId}, ${reason}, ${deleted.length}, ${files.length})`;
  await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, details)
           VALUES (${tenantId}, ${actorUserId}, 'data.deleted', ${tx.json({ reason, candidates: deleted.length, files: files.length })})`;
  return { candidates: deleted.length, files: files.length, keys: files };
}

/** Removes the stored audio files after the database rows are gone (a failed file delete is retried by the next run). */
export async function removeFiles(keys: string[] | undefined) {
  for (const k of keys ?? []) await deleteObject(k).catch(() => {});
}

/** One pass of the retention job across all tenants: expire links, send 48-hour notices, delete due data. */
export async function runRetention(now = new Date()) {
  return withContext({ superAdmin: true }, async tx => {
    const expired = await tx`UPDATE invitations SET status = 'expired' WHERE status IN ('pending', 'opened') AND expires_at < ${now} RETURNING id`;

    // 48-hour notices.
    const due = await tx`
      SELECT c.id, c.tenant_id, c.name, c.phone, c.email, c.delete_after, t.name AS company
      FROM candidates c JOIN tenants t ON t.id = c.tenant_id
      WHERE c.delete_after IS NOT NULL AND c.deletion_notified_at IS NULL
        AND c.delete_after <= ${now}::timestamptz + make_interval(hours => ${NOTICE_HOURS})`;
    for (const c of due) {
      const date = new Date(c.delete_after).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
      const body = `Hi ${firstName(c.name)}, as promised, ${c.company} will permanently delete your interview recordings and results on ${date}. No action is needed.`;
      if (c.phone) await tx`INSERT INTO outbox (tenant_id, template, channel, to_address, body) VALUES (${c.tenant_id}, 'deletion_notice', 'sms', ${c.phone}, ${body})`;
      if (c.email) await tx`INSERT INTO outbox (tenant_id, template, channel, to_address, subject, body) VALUES (${c.tenant_id}, 'deletion_notice', 'email', ${c.email}, ${`Your interview data with ${c.company} will be deleted on ${date}`}, ${body})`;
      await tx`UPDATE candidates SET deletion_notified_at = ${now} WHERE id = ${c.id}`;
    }

    // Deletion: due date passed and the notice went out at least 48 h ago (or no notice is owed: withdrawn/requested).
    const toDelete = await tx`
      SELECT id, tenant_id FROM candidates
      WHERE delete_after IS NOT NULL AND delete_after <= ${now}
        AND (deletion_notified_at <= ${now}::timestamptz - make_interval(hours => ${NOTICE_HOURS})
             OR EXISTS (SELECT 1 FROM consent_records cr WHERE cr.candidate_id = candidates.id AND cr.withdrawn_at IS NOT NULL))`;
    const byTenant = new Map<string, string[]>();
    for (const r of toDelete) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r.id]);
    let deleted = 0, files: string[] = [];
    for (const [tenantId, ids] of byTenant) {
      const r = await deleteCandidates(tx, tenantId, ids, 'retention', null);
      deleted += r.candidates;
      files = files.concat(r.keys ?? []);
    }
    return { expired: expired.length, notified: due.length, deleted, files };
  }).then(async r => { await removeFiles(r.files); return { ...r, files: r.files.length }; });
}
