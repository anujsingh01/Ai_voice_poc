// Load test: N candidates take the whole interview at the same moment (no pauses between answers,
// so far harsher than real traffic). Runs against a throwaway tenant that is deleted afterwards.
//
//   npm run load-test -- [candidates=200] [audio.wav]
//
// Needs the app running (npm run start) at APP_URL. Prints latency percentiles per step, then checks
// the database holds exactly what was uploaded.
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { sha256 } from '../src/lib/crypto';

const N = Number(process.argv[2] ?? 200);
const AUDIO = process.argv[3] ?? '../whisper-test/test-audio/malayalam-3.wav';
const BASE = process.env.APP_URL!;
const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 4, onnotice: () => {} });
const audio = await readFile(AUDIO);
const suffix = Date.now().toString(36);

// ---- Setup: tenant, 15-question bank, active job, N invitations ----
const [{ id: T }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Load test', ${'load-' + suffix}) RETURNING id`;
const cleanup = async () => {
  await admin`DELETE FROM tenants WHERE id = ${T}`;
  await rm(join(resolve(process.env.STORAGE_DIR ?? 'storage'), 'tenants', T), { recursive: true, force: true });
};
try {
  await admin`INSERT INTO tenant_limits (tenant_id, interviews_per_month) VALUES (${T}, 100000)`;
  const [{ id: bank }] = await admin`INSERT INTO question_banks (tenant_id, name) VALUES (${T}, 'Bank') RETURNING id`;
  const [{ id: version }] = await admin`INSERT INTO question_bank_versions (tenant_id, bank_id, version) VALUES (${T}, ${bank}, 1) RETURNING id`;
  await admin`INSERT INTO questions ${admin(Array.from({ length: 15 }, (_, i) => ({
    tenant_id: T, version_id: version, code: `Q${i}`, type: i < 10 ? 'question' : 'objection', category: 'c', weight: 1,
    texts: { hi: `प्रश्न ${i}` }, good_answer: 'g', average_answer: 'a', poor_answer: 'p', knockout: false, knockout_rule: null, position: i + 1,
  })))}`;
  const [{ id: job }] = await admin`INSERT INTO jobs (tenant_id, title, languages, bank_id, status, questions_per_interview, objections_per_interview)
                                    VALUES (${T}, 'Load job', '{hi}', ${bank}, 'active', 6, 3) RETURNING id`;
  await admin`INSERT INTO rubrics (tenant_id, job_id, version, dimensions, shortlist_cutoff) VALUES (${T}, ${job}, 1, '[]', 60)`;
  await admin`INSERT INTO consent_texts (tenant_id, version, texts, grievance_contact) VALUES (${T}, 1, '{"hi":"सहमति"}', 'grievance@example.com')`;
  const tokens = Array.from({ length: N }, () => randomBytes(32).toString('base64url'));
  const cands = await admin`INSERT INTO candidates ${admin(tokens.map((_, i) => ({ tenant_id: T, job_id: job, name: `Load Candidate ${i}`, phone: `+9198${String(i).padStart(8, '0')}` })))} RETURNING id`;
  await admin`INSERT INTO invitations ${admin(cands.map((c, i) => ({ tenant_id: T, candidate_id: c.id, token_hash: sha256(tokens[i]), expires_at: new Date(Date.now() + 864e5) })))}`;

  // ---- Run ----
  const timings: Record<string, number[]> = {};
  const errors: Record<string, number> = {};
  async function call(step: string, url: string, init?: RequestInit) {
    const t = performance.now();
    try {
      const res = await fetch(BASE + url, init);
      const body = await res.text();
      (timings[step] ??= []).push(performance.now() - t);
      if (!res.ok) { errors[`${step} ${res.status}`] = (errors[`${step} ${res.status}`] ?? 0) + 1; return null; }
      return JSON.parse(body);
    } catch (e) {
      errors[`${step} ${(e as Error).message}`] = (errors[`${step} ${(e as Error).message}`] ?? 0) + 1;
      return null;
    }
  }
  async function candidate(token: string) {
    if (!(await call('open link (state)', `/api/i/${token}/state`))) return false;
    const state = await call('consent + start', `/api/i/${token}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'hi', consent: true, adult: true }),
    });
    if (!state?.interview?.questions?.length) return false;
    for (const q of state.interview.questions as { position: number }[]) {
      const ok = await call('upload answer', `/api/i/${token}/answer/${q.position}?attempt=1&duration_ms=20000`, {
        method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: audio,
      });
      if (!ok) return false;
    }
    return !!(await call('finish', `/api/i/${token}/finish`, { method: 'POST' }));
  }

  console.log(`${N} candidates starting at once against ${BASE} (answer upload ${Math.round(audio.length / 1024)} KB)…`);
  const t0 = performance.now();
  const results = await Promise.all(tokens.map(candidate));
  const secs = (performance.now() - t0) / 1000;

  const pct = (xs: number[], p: number) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
  console.log(`\nFinished in ${secs.toFixed(1)} s · ${results.filter(Boolean).length}/${N} completed`);
  console.table(Object.fromEntries(Object.entries(timings).map(([k, xs]) => [k, {
    requests: xs.length, 'p50 ms': Math.round(pct(xs, 0.5)), 'p95 ms': Math.round(pct(xs, 0.95)), 'p99 ms': Math.round(pct(xs, 0.99)), 'max ms': Math.round(Math.max(...xs)),
  }])));
  const total = Object.values(timings).reduce((s, xs) => s + xs.length, 0);
  console.log(`Throughput: ${(total / secs).toFixed(0)} requests/s, ${((N * 9 * audio.length) / secs / 1024 / 1024).toFixed(1)} MB/s of audio`);
  console.log(Object.keys(errors).length ? { errors } : 'Errors: none');

  // ---- Integrity: what the DB holds must match what was uploaded ----
  const [db] = await admin`
    SELECT (SELECT count(*) FROM interviews WHERE tenant_id = ${T} AND status = 'completed')::int AS completed,
           (SELECT count(*) FROM answers WHERE tenant_id = ${T})::int AS answers,
           (SELECT count(*) FROM transcription_jobs WHERE tenant_id = ${T})::int AS transcription_jobs,
           (SELECT count(*) FROM consent_records WHERE tenant_id = ${T})::int AS consents,
           (SELECT count(*) FROM interviews iv WHERE tenant_id = ${T} AND (SELECT count(*) FROM interview_questions iq WHERE iq.interview_id = iv.id) <> 9)::int AS wrong_question_count`;
  console.log('Database:', db);
  const ok = db.completed === N && db.answers === N * 9 && db.transcription_jobs === N * 9 && db.consents === N && db.wrong_question_count === 0;
  console.log(ok ? 'Integrity: OK' : 'Integrity: MISMATCH');
  process.exitCode = ok && !Object.keys(errors).length ? 0 : 1;
} finally {
  await cleanup();
  await admin.end();
}
