// End-to-end scoring pipeline on the local database with the local stand-in scorer (no AI, no API key):
// queueing, Fast and Batch modes, usage metering, the monthly budget rules and the close-call second opinion.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@/db';
import { DEFAULT_DIMENSIONS } from '@/lib/rubric';
import { enqueueReady, runBatches, runOneFastJob } from '@/lib/scoring/service';

process.env.SCORING_PROVIDER = 'fake';
const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const suffix = Date.now().toString(36);
let tenant: string, job: string, version: string, consent: string, rubric: string;

const LONG = 'जी हाँ मैं रोज़ फ़ील्ड वर्क के लिए तैयार हूँ मैंने दो साल घर घर जाकर सिम कार्ड बेचे हैं warranty और safety के बारे में ग्राहक को समझाता था और हर दिन बीस घरों में जाता था मुझे लोगों से मिलना अच्छा लगता है';

/** A completed interview with two transcribed answers. */
async function completedInterview(name: string) {
  const [c] = await admin`INSERT INTO candidates (tenant_id, job_id, name, phone) VALUES (${tenant}, ${job}, ${name}, ${'+9198' + Math.floor(1e7 + Math.random() * 9e7)}) RETURNING id`;
  const [inv] = await admin`INSERT INTO invitations (tenant_id, candidate_id, token_hash, expires_at, status) VALUES (${tenant}, ${c.id}, ${'s' + suffix + name}, now() + interval '1 day', 'completed') RETURNING id`;
  const [cr] = await admin`INSERT INTO consent_records (tenant_id, candidate_id, invitation_id, consent_text_id, language, age_confirmed) VALUES (${tenant}, ${c.id}, ${inv.id}, ${consent}, 'hi', true) RETURNING id`;
  const [iv] = await admin`INSERT INTO interviews (tenant_id, job_id, candidate_id, invitation_id, consent_record_id, bank_version_id, rubric_id, language, answer_seconds, status, completed_at)
                           VALUES (${tenant}, ${job}, ${c.id}, ${inv.id}, ${cr.id}, ${version}, ${rubric}, 'hi', 90, 'completed', now()) RETURNING id`;
  const qs = await admin`SELECT id FROM questions WHERE version_id = ${version} ORDER BY position`;
  for (const [i, q] of qs.entries()) {
    const [iq] = await admin`INSERT INTO interview_questions (tenant_id, interview_id, position, question_id) VALUES (${tenant}, ${iv.id}, ${i + 1}, ${q.id}) RETURNING id`;
    const [a] = await admin`INSERT INTO answers (tenant_id, interview_question_id, storage_key, mime_type, size_bytes, duration_ms, transcript, low_confidence, metrics, transcribed_at)
      VALUES (${tenant}, ${iq.id}, ${`tenants/${tenant}/x.webm`}, 'audio/webm', 1, 30000, ${LONG}, false,
              ${admin.json({ duration_seconds: 30, speech_seconds: 26, pause_count: 1, long_pauses: 0, words: 45, words_per_minute: 150, filler_count: 0, fillers: {} })}, now()) RETURNING id`;
    await admin`INSERT INTO transcription_jobs (tenant_id, answer_id, status) VALUES (${tenant}, ${a.id}, 'done')`;
  }
  return iv.id as string;
}
const interview = async (id: string) => (await admin`SELECT score_status, final_score, score_flags FROM interviews WHERE id = ${id}`)[0];
const drain = async () => { while (await runOneFastJob()); };

beforeAll(async () => {
  [{ id: tenant }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Scoring Co', ${'scoring-' + suffix}) RETURNING id`;
  await admin`INSERT INTO tenant_limits (tenant_id, ai_budget_inr) VALUES (${tenant}, 1000)`;
  const [b] = await admin`INSERT INTO question_banks (tenant_id, name) VALUES (${tenant}, 'Bank') RETURNING id`;
  [{ id: version }] = await admin`INSERT INTO question_bank_versions (tenant_id, bank_id, version) VALUES (${tenant}, ${b.id}, 1) RETURNING id`;
  await admin`INSERT INTO questions ${admin([
    { tenant_id: tenant, version_id: version, code: 'Q01', type: 'question', category: 'Field work', weight: 1, texts: { hi: 'फ़ील्ड वर्क?' }, good_answer: 'g', average_answer: 'a', poor_answer: 'p', knockout: true, knockout_rule: 'Must say yes', position: 1, must_mention: [] },
    { tenant_id: tenant, version_id: version, code: 'OBJ01', type: 'objection', category: 'Price', weight: 3, texts: { hi: 'महँगा है' }, good_answer: 'g', average_answer: 'a', poor_answer: 'p', knockout: false, knockout_rule: null, position: 2, must_mention: ['warranty', 'safety'] },
  ])}`;
  [{ id: job }] = await admin`INSERT INTO jobs (tenant_id, title, languages, bank_id, status) VALUES (${tenant}, 'Field Sales', '{hi}', ${b.id}, 'active') RETURNING id`;
  [{ id: rubric }] = await admin`INSERT INTO rubrics (tenant_id, job_id, version, dimensions, shortlist_cutoff) VALUES (${tenant}, ${job}, 1, ${admin.json(DEFAULT_DIMENSIONS)}, 10) RETURNING id`;
  [{ id: consent }] = await admin`INSERT INTO consent_texts (tenant_id, version, texts, grievance_contact) VALUES (${tenant}, 1, '{"hi":"x"}', 'c') RETURNING id`;
});

afterAll(async () => {
  await admin`DELETE FROM tenants WHERE id = ${tenant}`;
  await Promise.all([admin.end(), sql.end()]);
});

describe('scoring pipeline', () => {
  it('does not score an interview while an answer is still being transcribed', async () => {
    const id = await completedInterview('Waiting One');
    await admin`UPDATE transcription_jobs SET status = 'leased' WHERE answer_id IN (SELECT a.id FROM answers a JOIN interview_questions iq ON iq.id = a.interview_question_id WHERE iq.interview_id = ${id})`;
    await enqueueReady();
    expect((await interview(id)).score_status).toBe('waiting');
    await admin`UPDATE transcription_jobs SET status = 'done' WHERE answer_id IN (SELECT a.id FROM answers a JOIN interview_questions iq ON iq.id = a.interview_question_id WHERE iq.interview_id = ${id})`;
  });

  it('Fast mode: scores, records model/prompt/rubric versions, meters the cost, and sets the final score', async () => {
    const id = await completedInterview('Fast One');
    await enqueueReady();
    expect((await interview(id)).score_status).toBe('queued');
    await drain();
    const iv = await interview(id);
    expect(['scored', 'needs_review']).toContain(iv.score_status);
    expect(Number(iv.final_score)).toBeGreaterThan(0);
    const [s] = await admin`SELECT model, prompt_version, rubric_id, total FROM scores WHERE interview_id = ${id}`;
    expect(s).toMatchObject({ model: 'fake-local', prompt_version: 'score-v1', rubric_id: rubric });
    const [u] = await admin`SELECT batch, billed_to, cost_inr FROM usage_ledger WHERE interview_id = ${id}`;
    expect(u.batch).toBe(false);
    expect(u.billed_to).toBe('platform');
    expect(Number(u.cost_inr)).toBeGreaterThan(0);
  });

  it('asks for an independent second opinion when the score is near the cut-off, and averages the two', async () => {
    const id = await completedInterview('Close Call');
    await enqueueReady();
    await runOneFastJob();
    const [p1] = await admin`SELECT total FROM scores WHERE interview_id = ${id} AND pass = 1`;
    await admin`UPDATE rubrics SET shortlist_cutoff = ${Math.round(Number(p1.total))} WHERE id = ${rubric}`;   // make it a close call
    await admin`DELETE FROM scores WHERE interview_id = ${id}`;
    await admin`UPDATE scoring_jobs SET status = 'queued' WHERE interview_id = ${id}`;
    await drain();
    const passes = await admin`SELECT pass FROM scores WHERE interview_id = ${id} ORDER BY pass`;
    expect(passes.map(p => p.pass)).toEqual([1, 2]);
    expect((await interview(id)).final_score).not.toBeNull();
    await admin`UPDATE rubrics SET shortlist_cutoff = 10 WHERE id = ${rubric}`;
  });

  it('switches to Batch (half price) from 90% of the monthly budget', async () => {
    await admin`INSERT INTO usage_ledger (tenant_id, kind, model, input_tokens, output_tokens, cost_inr, billed_to) VALUES (${tenant}, 'scoring', 'x', 0, 0, 900, 'platform')`;
    const id = await completedInterview('Batch One');
    await enqueueReady();
    const [j] = await admin`SELECT mode FROM scoring_jobs WHERE interview_id = ${id}`;
    expect(j.mode).toBe('batch');
    await runBatches();   // submits
    await runBatches();   // collects
    expect(['scored', 'needs_review']).toContain((await interview(id)).score_status);
    const [u] = await admin`SELECT batch FROM usage_ledger WHERE interview_id = ${id}`;
    expect(u.batch).toBe(true);
  });

  it('pauses at 100% of the budget (transcripts kept) and resumes when the budget is raised', async () => {
    await admin`INSERT INTO usage_ledger (tenant_id, kind, model, input_tokens, output_tokens, cost_inr, billed_to) VALUES (${tenant}, 'scoring', 'x', 0, 0, 200, 'platform')`;
    const id = await completedInterview('Paused One');
    await enqueueReady();
    expect((await interview(id)).score_status).toBe('paused_budget');
    await admin`UPDATE tenant_limits SET ai_budget_inr = 100000 WHERE tenant_id = ${tenant}`;
    await enqueueReady();
    await drain();
    expect(['scored', 'needs_review']).toContain((await interview(id)).score_status);
  });

  it('a tenant cannot read another tenant’s scores or costs', async () => {
    const [other] = await admin`INSERT INTO tenants (name, slug) VALUES ('Other', ${'other-' + suffix}) RETURNING id`;
    const rows = await sql.begin(async tx => {
      await tx`SELECT set_config('app.tenant_id', ${other.id}, true)`;
      return [...(await tx`SELECT 1 FROM scores WHERE tenant_id = ${tenant}`), ...(await tx`SELECT 1 FROM usage_ledger WHERE tenant_id = ${tenant}`)];
    });
    expect(rows).toHaveLength(0);
    await admin`DELETE FROM tenants WHERE id = ${other.id}`;
  });
});
