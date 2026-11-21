// End-to-end check of the whole pipeline on the running app, with a throwaway tenant:
// candidate link → consent → 9 real recorded answers → finish → real transcription worker →
// scoring → results, plus the access rules around it. Deleted afterwards.
//
//   npm run e2e-test -- [audio.wav]
//
// Needs: the app (npm run start) at APP_URL and at least one transcription worker running.
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { sha256 } from '../src/lib/crypto';
import { DEFAULT_CUTOFF, DEFAULT_DIMENSIONS } from '../src/lib/rubric';
import { closePool, enqueueReady, runOneFastJob } from '../src/lib/scoring/service';

const AUDIO = process.argv[2] ?? '../whisper-test/test-audio/sample-hindi.wav';
const BASE = process.env.APP_URL!;
const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 2, onnotice: () => {} });
const audio = await readFile(AUDIO);
const suffix = Date.now().toString(36);
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };
// One retry on a reset: the server deliberately drops the connection after refusing an oversized upload.
const req = (path: string, init?: RequestInit) =>
  fetch(BASE + path, { redirect: 'manual', ...init }).catch(() => fetch(BASE + path, { redirect: 'manual', ...init }));

const [{ id: T }] = await admin`INSERT INTO tenants (name, slug) VALUES ('E2E', ${'e2e-' + suffix}) RETURNING id`;
try {
  await admin`INSERT INTO tenant_limits (tenant_id, retention_days) VALUES (${T}, 90)`;
  const [{ id: bank }] = await admin`INSERT INTO question_banks (tenant_id, name) VALUES (${T}, 'Bank') RETURNING id`;
  const [{ id: version }] = await admin`INSERT INTO question_bank_versions (tenant_id, bank_id, version) VALUES (${T}, ${bank}, 1) RETURNING id`;
  await admin`INSERT INTO questions ${admin(Array.from({ length: 12 }, (_, i) => ({
    tenant_id: T, version_id: version, code: `Q${i}`, type: i < 8 ? 'question' : 'objection', category: 'Sales', weight: 1,
    texts: { hi: `आप ग्राहक से कैसे बात करेंगे? (${i})` }, good_answer: 'Listens, explains benefits, asks for the order',
    average_answer: 'Explains the product', poor_answer: 'Argues or gives up', knockout: false, knockout_rule: null, position: i + 1,
  })))}`;
  const [{ id: job }] = await admin`INSERT INTO jobs (tenant_id, title, languages, bank_id, status, questions_per_interview, objections_per_interview)
                                    VALUES (${T}, 'Field Sales', '{hi}', ${bank}, 'active', 6, 3) RETURNING id`;
  await admin`INSERT INTO rubrics (tenant_id, job_id, version, dimensions, shortlist_cutoff) VALUES (${T}, ${job}, 1, ${admin.json(DEFAULT_DIMENSIONS)}, ${DEFAULT_CUTOFF})`;
  await admin`INSERT INTO consent_texts (tenant_id, version, texts, grievance_contact) VALUES (${T}, 1, '{"hi":"{company} आपकी आवाज़ {days} दिन रखेगा"}', 'dpo@example.com')`;
  const token = randomBytes(32).toString('base64url');
  const [{ id: cand }] = await admin`INSERT INTO candidates (tenant_id, job_id, name, phone) VALUES (${T}, ${job}, 'Asha Verma', '+919811122233') RETURNING id`;
  await admin`INSERT INTO invitations (tenant_id, candidate_id, token_hash, expires_at) VALUES (${T}, ${cand}, ${sha256(token)}, now() + interval '1 day')`;

  console.log('— Candidate');
  const state = await (await req(`/api/i/${token}/state`)).json();
  check('link opens with consent notice in Hindi, retention filled in', state.consent?.hi?.includes('90'), state.consent?.hi);
  check('under-18 is stopped before anything is stored', (await req(`/api/i/${token}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'hi', consent: true, adult: false }) })).status === 403);
  const started = await (await req(`/api/i/${token}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'hi', consent: true, adult: true }) })).json();
  const qs = started.interview?.questions ?? [];
  check('consent recorded and 9 questions drawn', qs.length === 9);
  check('a non-audio upload is refused', (await req(`/api/i/${token}/answer/1?attempt=1&duration_ms=5000`, { method: 'PUT', body: '<script>alert(1)</script>'.repeat(10) })).status === 415);
  check('finishing early is refused', (await req(`/api/i/${token}/finish`, { method: 'POST' })).status === 409);
  for (const q of qs) await req(`/api/i/${token}/answer/${q.position}?attempt=1&duration_ms=5000`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: audio });
  check('re-record allowed once', (await req(`/api/i/${token}/answer/1?attempt=2&duration_ms=5000`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: audio })).ok);
  // A streamed body with no Content-Length must still be cut off at 15 MB.
  const huge = new ReadableStream({ start(c) { const mb = new Uint8Array(1024 * 1024); mb.set(audio.subarray(0, 64)); for (let i = 0; i < 20; i++) c.enqueue(mb); c.close(); } });
  check('20 MB streamed upload is cut off', (await req(`/api/i/${token}/answer/3?attempt=2&duration_ms=5000`, { method: 'PUT', body: huge, duplex: 'half' } as RequestInit)).status === 413);
  await admin`UPDATE answers SET uploaded_at = now() - interval '10 minutes' WHERE tenant_id = ${T}`;
  check('replaying an old recording is refused (only quick retries)', (await req(`/api/i/${token}/answer/1?attempt=2&duration_ms=5000`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: audio })).status === 409);
  check('finish', (await req(`/api/i/${token}/finish`, { method: 'POST' })).ok);
  check('uploads after finishing are refused', (await req(`/api/i/${token}/answer/2?attempt=2&duration_ms=5000`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: audio })).status === 409);
  const [iv] = await admin`SELECT iv.id, c.delete_after FROM interviews iv JOIN candidates c ON c.id = iv.candidate_id WHERE iv.tenant_id = ${T}`;
  check('retention clock started', !!iv.delete_after);

  console.log('— Transcription (real worker)');
  const t0 = Date.now();
  let pending = 9;
  while (pending > 0 && Date.now() - t0 < 300_000) {
    await new Promise(r => setTimeout(r, 3000));
    [{ pending }] = await admin`SELECT count(*)::int AS pending FROM transcription_jobs WHERE tenant_id = ${T} AND status <> 'done'`;
  }
  const answers = await admin`SELECT a.transcript, a.asr_model FROM answers a WHERE a.tenant_id = ${T}`;
  check('all 9 answers transcribed', pending === 0 && answers.every(a => a.transcript?.length > 0), `${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(`  e.g. “${answers[0]?.transcript?.slice(0, 80)}” [${answers[0]?.asr_model}]`);

  console.log(`— Scoring (provider: ${process.env.SCORING_PROVIDER ?? 'openai'})`);
  await enqueueReady();
  while (await runOneFastJob()) { /* drain */ }
  const [s] = await admin`SELECT final_score, score_status, score_flags FROM interviews WHERE id = ${iv.id}`;
  check('interview scored', s.final_score != null, `${s.final_score} · ${s.score_status}`);
  const [u] = await admin`SELECT count(*)::int AS n FROM usage_ledger WHERE tenant_id = ${T}`;
  check('AI usage metered to the tenant', u.n > 0);

  console.log('— Access rules');
  check('recruiter pages need sign-in', [302, 303, 307].includes((await req(`/t/e2e-${suffix}/interviews/${iv.id}`)).status));
  check('worker API needs a worker token', (await req('/api/worker/lease', { method: 'POST' })).status === 401);
  check('unknown interview link is 404', (await req(`/api/i/${randomBytes(32).toString('base64url')}/state`)).status === 404);
  const health = await (await req('/api/health')).json();
  check('public health check reveals only up/down', Object.keys(health).join() === 'status');
  const [audit] = await admin`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${T} AND action = 'interview.completed'`;
  check('completion written to the audit log', audit.n === 1);
} finally {
  await admin`DELETE FROM tenants WHERE id = ${T}`;
  await rm(join(resolve(process.env.STORAGE_DIR ?? 'storage'), 'tenants', T), { recursive: true, force: true });
  await Promise.all([admin.end(), closePool()]);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nEnd-to-end: all checks passed');
process.exitCode = failures ? 1 : 0;
