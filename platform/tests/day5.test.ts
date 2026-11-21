// Results ranking, decisions history, CSV safety, retention (notice → deletion), withdrawal, isolation.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withContext } from '@/db';
import { csvCell, csvPhone, jobResults } from '@/lib/results';
import { NOTICE_HOURS, runRetention } from '@/lib/retention';

const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const suffix = Date.now().toString(36);
let T: string, other: string, job: string, version: string, consent: string, rubric: string;

async function interview(name: string, score: number | null, completedDaysAgo = 0) {
  const [c] = await admin`INSERT INTO candidates (tenant_id, job_id, name, phone) VALUES (${T}, ${job}, ${name}, ${'+9190' + Math.floor(1e7 + Math.random() * 9e7)}) RETURNING id`;
  const [inv] = await admin`INSERT INTO invitations (tenant_id, candidate_id, token_hash, expires_at, status) VALUES (${T}, ${c.id}, ${'d5' + suffix + name}, now() + interval '1 day', 'completed') RETURNING id`;
  const [cr] = await admin`INSERT INTO consent_records (tenant_id, candidate_id, invitation_id, consent_text_id, language, age_confirmed) VALUES (${T}, ${c.id}, ${inv.id}, ${consent}, 'hi', true) RETURNING id`;
  const [iv] = await admin`INSERT INTO interviews (tenant_id, job_id, candidate_id, invitation_id, consent_record_id, bank_version_id, rubric_id, language, answer_seconds, status, completed_at, final_score, score_status)
                           VALUES (${T}, ${job}, ${c.id}, ${inv.id}, ${cr.id}, ${version}, ${rubric}, 'hi', 90, 'completed', now() - make_interval(days => ${completedDaysAgo}), ${score}, ${score == null ? 'waiting' : 'scored'}) RETURNING id`;
  return { candidate: c.id as string, interview: iv.id as string };
}

beforeAll(async () => {
  [{ id: T }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Day5 Co', ${'day5-' + suffix}) RETURNING id`;
  [{ id: other }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Day5 Other', ${'day5o-' + suffix}) RETURNING id`;
  await admin`INSERT INTO tenant_limits (tenant_id, retention_days) VALUES (${T}, 30), (${other}, 30)`;
  const [b] = await admin`INSERT INTO question_banks (tenant_id, name) VALUES (${T}, 'Bank') RETURNING id`;
  [{ id: version }] = await admin`INSERT INTO question_bank_versions (tenant_id, bank_id, version) VALUES (${T}, ${b.id}, 1) RETURNING id`;
  [{ id: job }] = await admin`INSERT INTO jobs (tenant_id, title, languages, bank_id, status) VALUES (${T}, 'Sales', '{hi,en}', ${b.id}, 'active') RETURNING id`;
  [{ id: rubric }] = await admin`INSERT INTO rubrics (tenant_id, job_id, version, dimensions, shortlist_cutoff) VALUES (${T}, ${job}, 1, '[]', 60) RETURNING id`;
  [{ id: consent }] = await admin`INSERT INTO consent_texts (tenant_id, version, texts, grievance_contact) VALUES (${T}, 1, '{"hi":"x"}', 'c') RETURNING id`;
});

afterAll(async () => {
  await admin`DELETE FROM tenants WHERE id IN (${T}, ${other})`;
  await Promise.all([admin.end(), sql.end()]);
});

describe('recruiter results', () => {
  it('ranks by score, lets a recruiter override win, and filters by decision', async () => {
    const a = await interview('Asha', 72), c = await interview('Chitra', 40);
    await interview('Bala', 65);
    await admin`INSERT INTO score_overrides (tenant_id, interview_id, ai_score, new_score, reason) VALUES (${T}, ${c.interview}, 40, 80, 'Strong answers the AI under-rated')`;
    await admin`INSERT INTO decisions (tenant_id, interview_id, decision, reason) VALUES (${T}, ${a.interview}, 'reject', 'first'), (${T}, ${a.interview}, 'shortlist', 'changed mind')`;
    const all = await withContext({ tenantId: T }, tx => jobResults(tx, job, { view: 'all' }));
    expect(all.rows.map(r => r.name)).toEqual(['Chitra', 'Asha', 'Bala']);       // 80 (override), 72, 65
    expect(all.rows[0]).toMatchObject({ ai_score: 40, override_score: 80, score: 80 });
    expect(all.rows[1].decision).toBe('shortlist');                               // the latest decision wins
    expect(all.counts).toMatchObject({ all: 3, shortlist: 1, undecided: 2, reject: 0 });
    const undecided = await withContext({ tenantId: T }, tx => jobResults(tx, job, { view: 'undecided', min: 70 }));
    expect(undecided.rows.map(r => r.name)).toEqual(['Chitra']);
  });

  it('decision and override history can’t be rewritten', async () => {
    await expect(withContext({ tenantId: T }, tx => tx`UPDATE decisions SET decision = 'reject'`)).rejects.toThrow(/permission denied/);
    await expect(withContext({ tenantId: T }, tx => tx`DELETE FROM score_overrides`)).rejects.toThrow(/permission denied/);
  });

  it('another tenant sees none of the decisions, comments or requests', async () => {
    const rows = await withContext({ tenantId: other }, async tx => [
      ...(await tx`SELECT 1 FROM decisions WHERE tenant_id = ${T}`), ...(await tx`SELECT 1 FROM score_overrides WHERE tenant_id = ${T}`),
      ...(await tx`SELECT 1 FROM comments WHERE tenant_id = ${T}`), ...(await tx`SELECT 1 FROM rights_requests WHERE tenant_id = ${T}`),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('CSV export neutralises formulas and escapes quotes', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+91 98765')).toBe(`"'+91 98765"`);
    expect(csvCell('Rao, Priya')).toBe('"Rao, Priya"');
    expect(csvCell(null)).toBe('""');
    expect(csvPhone('+919876543210')).toBe('"+919876543210"');       // validated numbers keep their +
    expect(csvPhone('+1=cmd|x')).toBe(`"'+1=cmd|x"`);                  // anything else is still guarded
  });
});

describe('retention', () => {
  it('sends a 48-hour notice first, then deletes everything after the notice period', async () => {
    const x = await interview('Expiring', 55, 31);
    await admin`UPDATE candidates SET delete_after = now() + interval '1 hour' WHERE id = ${x.candidate}`;
    await admin`INSERT INTO rights_requests (tenant_id, candidate_id, candidate_ref, kind, due_at) VALUES (${T}, ${x.candidate}, 'Expiring · +91…123', 'access', now() + interval '30 days')`;

    const t0 = new Date();
    await runRetention(t0);
    const [n] = await admin`SELECT deletion_notified_at IS NOT NULL AS notified FROM candidates WHERE id = ${x.candidate}`;
    expect(n.notified).toBe(true);
    const [msg] = await admin`SELECT body FROM outbox WHERE tenant_id = ${T} AND body LIKE '%permanently delete%' LIMIT 1`;
    expect(msg.body).toMatch(/Day5 Co will permanently delete/);

    await runRetention(new Date(t0.getTime() + 2 * 3600e3));                    // due, but notice is only 2 h old
    expect(await admin`SELECT 1 FROM candidates WHERE id = ${x.candidate}`).toHaveLength(1);

    await runRetention(new Date(t0.getTime() + (NOTICE_HOURS + 1) * 3600e3));   // notice period over
    expect(await admin`SELECT 1 FROM candidates WHERE id = ${x.candidate}`).toHaveLength(0);
    expect(await admin`SELECT 1 FROM interviews WHERE id = ${x.interview}`).toHaveLength(0);
    const [req] = await admin`SELECT candidate_id, candidate_ref FROM rights_requests WHERE tenant_id = ${T} AND candidate_ref LIKE 'Expiring%'`;
    expect(req).toEqual({ candidate_id: null, candidate_ref: 'Expiring · +91…123' });   // the request record survives, without the data
    const [log] = await admin`SELECT reason, candidates FROM deletion_log WHERE tenant_id = ${T} ORDER BY id DESC LIMIT 1`;
    expect(log).toEqual({ reason: 'retention', candidates: 1 });
  });

  it('withdrawn consent is deleted at the next run, without waiting for a notice', async () => {
    const w = await interview('Withdrawn', 50);
    await admin`UPDATE consent_records SET withdrawn_at = now() WHERE candidate_id = ${w.candidate}`;
    // A minute back: the database container's clock can run a little ahead of this machine's.
    await admin`UPDATE candidates SET delete_after = now() - interval '1 minute' WHERE id = ${w.candidate}`;
    await runRetention();
    expect(await admin`SELECT 1 FROM candidates WHERE id = ${w.candidate}`).toHaveLength(0);
  });

  it('expires invite links past their date', async () => {
    const [c] = await admin`INSERT INTO candidates (tenant_id, job_id, name, phone) VALUES (${T}, ${job}, 'Late', '+919000011111') RETURNING id`;
    const [i] = await admin`INSERT INTO invitations (tenant_id, candidate_id, token_hash, expires_at) VALUES (${T}, ${c.id}, ${'late' + suffix}, now() - interval '1 minute') RETURNING id`;
    await runRetention();
    expect((await admin`SELECT status FROM invitations WHERE id = ${i.id}`)[0].status).toBe('expired');
  });
});
