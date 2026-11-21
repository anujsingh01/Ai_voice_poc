// Interview start (question draw, consent record) and the transcription queue (leases, retries, late
// results), run against the local database exactly as the app runs them.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withContext } from '@/db';
import type { Invite } from '@/lib/interview';
import { startInterview } from '@/lib/interview';
import { asWorker, failJob, leaseJob, saveResult, MAX_ATTEMPTS } from '@/lib/worker-api';

const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const suffix = Date.now().toString(36);
const ids: Record<string, string> = {};
let invite: Invite;

beforeAll(async () => {
  [{ id: ids.tenant }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Flow', ${'flow-' + suffix}) RETURNING id`;
  const T = ids.tenant;
  await admin`INSERT INTO tenant_limits (tenant_id) VALUES (${T})`;
  [{ id: ids.bank }] = await admin`INSERT INTO question_banks (tenant_id, name) VALUES (${T}, 'Bank') RETURNING id`;
  [{ id: ids.version }] = await admin`INSERT INTO question_bank_versions (tenant_id, bank_id, version) VALUES (${T}, ${ids.bank}, 1) RETURNING id`;
  // 2 knockouts, 8 ordinary questions, 5 objections; one question has no Hindi text.
  const q = (code: string, type: string, knockout: boolean, texts: Record<string, string>, pos: number) => ({
    tenant_id: T, version_id: ids.version, code, type, category: 'c', weight: 1, texts, good_answer: 'g', average_answer: 'a',
    poor_answer: 'p', knockout, knockout_rule: knockout ? 'say yes' : null, position: pos,
  });
  const rows = [
    q('K1', 'question', true, { hi: 'k1', en: 'k1' }, 1), q('K2', 'question', true, { hi: 'k2', en: 'k2' }, 2),
    ...Array.from({ length: 8 }, (_, i) => q(`Q${i}`, 'question', false, { hi: `q${i}`, en: `q${i}` }, 3 + i)),
    q('QX', 'question', false, { en: 'english only' }, 11),
    ...Array.from({ length: 5 }, (_, i) => q(`O${i}`, 'objection', false, { hi: `o${i}`, en: `o${i}` }, 12 + i)),
  ];
  await admin`INSERT INTO questions ${admin(rows)}`;
  [{ id: ids.job }] = await admin`INSERT INTO jobs (tenant_id, title, languages, bank_id, status, questions_per_interview, objections_per_interview)
                                   VALUES (${T}, 'Job', '{hi,en}', ${ids.bank}, 'active', 6, 3) RETURNING id`;
  await admin`INSERT INTO rubrics (tenant_id, job_id, version, dimensions, shortlist_cutoff) VALUES (${T}, ${ids.job}, 1, '[]', 60)`;
  await admin`INSERT INTO consent_texts (tenant_id, version, texts, grievance_contact) VALUES (${T}, 1, '{"hi":"x","en":"y"}', 'c')`;
  [{ id: ids.candidate }] = await admin`INSERT INTO candidates (tenant_id, job_id, name, phone) VALUES (${T}, ${ids.job}, 'C', '+919876543210') RETURNING id`;
  [{ id: ids.invitation }] = await admin`INSERT INTO invitations (tenant_id, candidate_id, token_hash, expires_at) VALUES (${T}, ${ids.candidate}, ${'flow' + suffix}, now() + interval '1 day') RETURNING id`;
  [{ id: ids.worker }] = await admin`INSERT INTO workers (name, token_hash) VALUES ('test', ${'w' + suffix}) RETURNING id`;
  [{ id: ids.worker2 }] = await admin`INSERT INTO workers (name, token_hash) VALUES ('test2', ${'w2' + suffix}) RETURNING id`;
  invite = { invitation_id: ids.invitation, tenant_id: T, tenant_name: 'Flow', tenant_status: 'active', candidate_name: 'C',
             job_title: 'J', job_status: 'active', languages: ['hi', 'en'], status: 'pending', expires_at: new Date(Date.now() + 864e5) };
});

afterAll(async () => {
  await admin`DELETE FROM tenants WHERE id = ${ids.tenant}`;
  await admin`DELETE FROM workers WHERE token_hash LIKE ${'%' + suffix}`;
  await Promise.all([admin.end(), sql.end()]);
});

describe('starting an interview', () => {
  it('rejects a language the job does not offer', async () => {
    await expect(withContext({ tenantId: ids.tenant }, tx => startInterview(tx, invite, 'ta', null, null))).rejects.toThrow('language');
  });

  it('records consent and draws knockouts first, then questions, then objections, in the chosen language', async () => {
    const id = await withContext({ tenantId: ids.tenant }, tx => startInterview(tx, invite, 'hi', '1.2.3.4', 'test'));
    ids.interview = id;
    const plan = await admin`
      SELECT iq.position, q.code, q.type FROM interview_questions iq JOIN questions q ON q.id = iq.question_id
      WHERE iq.interview_id = ${id} ORDER BY iq.position`;
    expect(plan).toHaveLength(9);                                         // 6 questions + 3 objections
    expect(plan.slice(0, 2).map(p => p.code)).toEqual(['K1', 'K2']);      // knockouts always asked, first
    expect(plan.slice(2, 6).every(p => p.type === 'question' && p.code.startsWith('Q'))).toBe(true);
    expect(plan.slice(6).every(p => p.type === 'objection')).toBe(true);
    expect(plan.map(p => p.code)).not.toContain('QX');                    // no Hindi text: never drawn for Hindi
    const [cr] = await admin`SELECT cr.language, cr.age_confirmed, cr.ip FROM interviews iv JOIN consent_records cr ON cr.id = iv.consent_record_id WHERE iv.id = ${id}`;
    expect(cr).toEqual({ language: 'hi', age_confirmed: true, ip: '1.2.3.4' });
    const [inv] = await admin`SELECT status FROM invitations WHERE id = ${ids.invitation}`;
    expect(inv.status).toBe('opened');
  });

  it('is idempotent: starting again returns the same interview and questions', async () => {
    const again = await withContext({ tenantId: ids.tenant }, tx => startInterview(tx, invite, 'en', null, null));
    expect(again).toBe(ids.interview);
  });

  it('consent records cannot be rewritten by the app', async () => {
    await expect(withContext({ tenantId: ids.tenant }, tx => tx`UPDATE consent_records SET language = 'en'`)).rejects.toThrow(/permission denied/);
  });
});

describe('transcription queue', () => {
  const addAnswer = async (position: number) => {
    const [iq] = await admin`SELECT id FROM interview_questions WHERE interview_id = ${ids.interview} AND position = ${position}`;
    const [a] = await admin`INSERT INTO answers (tenant_id, interview_question_id, storage_key, mime_type, size_bytes, duration_ms)
                            VALUES (${ids.tenant}, ${iq.id}, ${`tenants/${ids.tenant}/a${position}.webm`}, 'audio/webm', 10, 20000) RETURNING id`;
    await admin`INSERT INTO transcription_jobs (tenant_id, answer_id) VALUES (${ids.tenant}, ${a.id})`;
    return a.id as string;
  };
  const result = { transcript: 'नमस्ते', language: 'hi', model: 'test', confidence: 0.9,
    metrics: { duration_seconds: 20, speech_seconds: 15, pause_count: 1, long_pauses: 0, words: 30, words_per_minute: 120, filler_count: 0, fillers: {} } };

  it('hands each job to exactly one worker, with the language and product hints', async () => {
    const answerId = await addAnswer(1);
    const [a, b] = await Promise.all([asWorker(tx => leaseJob(tx, ids.worker)), asWorker(tx => leaseJob(tx, ids.worker2))]);
    const leased = [a, b].filter(Boolean);
    expect(leased).toHaveLength(1);
    expect(leased[0]).toMatchObject({ language: 'hi', durationMs: 20000, attempt: 1 });
    expect(leased[0]!.hints).toContain('Prestige');
    const holder = a ? ids.worker : ids.worker2, other = a ? ids.worker2 : ids.worker;
    expect(await asWorker(tx => saveResult(tx, leased[0]!.id, other, result))).toBe(false);   // not their lease
    expect(await asWorker(tx => saveResult(tx, leased[0]!.id, holder, result))).toBe(true);
    const [ans] = await admin`SELECT transcript, low_confidence, transcribed_at IS NOT NULL AS done FROM answers WHERE id = ${answerId}`;
    expect(ans).toEqual({ transcript: 'नमस्ते', low_confidence: false, done: true });
  });

  it('flags low confidence or very little speech for a human (never auto-rejects)', async () => {
    const answerId = await addAnswer(2);
    const job = await asWorker(tx => leaseJob(tx, ids.worker));
    await asWorker(tx => saveResult(tx, job!.id, ids.worker, { ...result, metrics: { ...result.metrics, speech_seconds: 2 } }));
    const [ans] = await admin`SELECT low_confidence FROM answers WHERE id = ${answerId}`;
    expect(ans.low_confidence).toBe(true);
  });

  it('gives an expired lease to another worker, and ignores the first worker’s late result', async () => {
    await addAnswer(3);
    const job = await asWorker(tx => leaseJob(tx, ids.worker));
    await admin`UPDATE transcription_jobs SET leased_until = now() - interval '1 second' WHERE id = ${job!.id}`;
    const retaken = await asWorker(tx => leaseJob(tx, ids.worker2));
    expect(retaken!.id).toBe(job!.id);
    expect(retaken!.attempt).toBe(2);
    expect(await asWorker(tx => saveResult(tx, job!.id, ids.worker, result))).toBe(false);
    expect(await asWorker(tx => saveResult(tx, job!.id, ids.worker2, result))).toBe(true);
  });

  it(`re-queues a failed job, and parks it as failed after ${MAX_ATTEMPTS} attempts`, async () => {
    await addAnswer(4);
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const job = await asWorker(tx => leaseJob(tx, ids.worker));
      const status = await asWorker(tx => failJob(tx, job!.id, ids.worker, 'decoder error'));
      expect(status).toBe(i < MAX_ATTEMPTS ? 'queued' : 'failed');
    }
    expect(await asWorker(tx => leaseJob(tx, ids.worker))).toBeNull();
  });
});
