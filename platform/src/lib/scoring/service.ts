import { sql, withContext, type Tx } from '@/db';
import { decrypt } from '../crypto';
import type { Dimension } from '../rubric';
import { computeScore, isCloseCall, passesDisagree, aiReply, type AnswerForScoring, type ComputedScore } from './compute';
import { maskTranscript } from './mask';
import { collectBatch, costInr, scoreFast, submitBatch, type ScoreCall } from './openai';
import { PROMPT_VERSION, type ScoringInput } from './prompt';

// The scoring pipeline. Runs in the scoring worker process (scripts/scoring-worker.mts), across tenants.
// Network calls to OpenAI happen outside database transactions; each step is short and safe to repeat.

const asPlatform = <T,>(fn: (tx: Tx) => Promise<T>) => withContext({ superAdmin: true }, fn);
const MAX_ATTEMPTS = 3;
const QUOTE_RETRIES = 1;    // re-score once if a quote isn't found in the transcript
const BATCH_SIZE = 200;

// ---------- budget ----------

export type Billing = { mode: 'fast' | 'batch'; billedTo: 'platform' | 'tenant'; apiKey: string | null; paused: boolean };

/** Monthly AI budget rules: Batch from 90% of budget, pause at 100%. A tenant's own key skips the budget. */
export async function billingFor(tx: Tx, tenantId: string): Promise<Billing> {
  const [l] = await tx`
    SELECT l.scoring_mode, l.ai_budget_inr, l.own_openai_key, s.openai_key_enc,
      (SELECT coalesce(sum(cost_inr), 0) FROM usage_ledger u WHERE u.tenant_id = l.tenant_id AND u.billed_to = 'platform'
         AND u.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::float AS spent
    FROM tenant_limits l LEFT JOIN tenant_secrets s ON s.tenant_id = l.tenant_id WHERE l.tenant_id = ${tenantId}`;
  if (l.own_openai_key && l.openai_key_enc) {
    return { mode: l.scoring_mode, billedTo: 'tenant', apiKey: decrypt(l.openai_key_enc), paused: false };
  }
  const used = l.ai_budget_inr > 0 ? l.spent / l.ai_budget_inr : 1;
  return {
    mode: used >= 0.9 ? 'batch' : l.scoring_mode, billedTo: 'platform', paused: used >= 1,
    apiKey: process.env.OPENAI_API_KEY ?? null,
  };
}

// ---------- queueing ----------

/** Completed interviews whose answers are all transcribed get a scoring job (or wait for budget). */
export async function enqueueReady() {
  return asPlatform(async tx => {
    const ready = await tx`
      SELECT iv.id, iv.tenant_id FROM interviews iv
      WHERE iv.status = 'completed' AND iv.score_status IN ('waiting', 'paused_budget')
        AND NOT EXISTS (
          SELECT 1 FROM interview_questions iq JOIN answers a ON a.interview_question_id = iq.id
          JOIN transcription_jobs tj ON tj.answer_id = a.id
          WHERE iq.interview_id = iv.id AND tj.status IN ('queued', 'leased'))
      ORDER BY iv.completed_at LIMIT 500`;
    let queued = 0;
    for (const iv of ready) {
      const billing = await billingFor(tx, iv.tenant_id);
      if (billing.paused || !billing.apiKey && process.env.SCORING_PROVIDER !== 'fake') {
        await tx`UPDATE interviews SET score_status = 'paused_budget' WHERE id = ${iv.id} AND score_status <> 'paused_budget'`;
        continue;
      }
      await tx`INSERT INTO scoring_jobs (tenant_id, interview_id, pass, mode) VALUES (${iv.tenant_id}, ${iv.id}, 1, ${billing.mode})
               ON CONFLICT (interview_id, pass) DO NOTHING`;
      await tx`UPDATE interviews SET score_status = 'queued' WHERE id = ${iv.id}`;
      queued++;
    }
    return queued;
  });
}

// ---------- building the request ----------

export async function loadScoringInput(tx: Tx, interviewId: string) {
  const [iv] = await tx`
    SELECT iv.*, c.name AS candidate, j.title, t.name AS company, r.dimensions, r.shortlist_cutoff
    FROM interviews iv JOIN candidates c ON c.id = iv.candidate_id JOIN jobs j ON j.id = iv.job_id
    JOIN tenants t ON t.id = iv.tenant_id JOIN rubrics r ON r.id = iv.rubric_id WHERE iv.id = ${interviewId}`;
  const rows = await tx`
    SELECT iq.position, q.code, q.type, q.category, q.weight, q.texts, q.good_answer, q.average_answer, q.poor_answer,
           q.must_mention, q.knockout, q.knockout_rule, a.transcript, a.metrics, a.low_confidence, tj.status AS asr_status
    FROM interview_questions iq JOIN questions q ON q.id = iq.question_id
    LEFT JOIN answers a ON a.interview_question_id = iq.id LEFT JOIN transcription_jobs tj ON tj.answer_id = a.id
    WHERE iq.interview_id = ${interviewId} ORDER BY iq.position`;
  const rubric = iv.dimensions as Dimension[];
  const answers: AnswerForScoring[] = rows.map(r => ({
    answer_id: `A${r.position}`, code: r.code, type: r.type, category: r.category, weight: r.weight,
    question: (r.texts as Record<string, string>)[iv.language] ?? (r.texts as Record<string, string>).en,
    good_answer: r.good_answer, average_answer: r.average_answer, poor_answer: r.poor_answer, must_mention: r.must_mention,
    knockout_rule: r.knockout ? r.knockout_rule : null,
    transcript: maskTranscript(r.transcript ?? '', iv.candidate),
    metrics: r.metrics, low_confidence: r.asr_status === 'failed' ? true : r.low_confidence,
  }));
  const input: ScoringInput = {
    company: iv.company, job_title: iv.title, language: iv.language,
    dimensions: rubric.filter(d => d.source === 'ai').map(d => ({ key: d.key, label: d.label })),
    // Only what the scorer needs: no metrics, flags or question codes.
    answers: answers.map(a => ({
      answer_id: a.answer_id, type: a.type, category: a.category, weight: a.weight, question: a.question,
      good_answer: a.good_answer, average_answer: a.average_answer, poor_answer: a.poor_answer,
      must_mention: a.must_mention, knockout_rule: a.knockout_rule, transcript: a.transcript,
    })),
  };
  return { input, answers, rubric, cutoff: iv.shortlist_cutoff as number, tenantId: iv.tenant_id as string, rubricId: iv.rubric_id as string, language: iv.language as string };
}

// ---------- saving a result ----------

type Loaded = Awaited<ReturnType<typeof loadScoringInput>>;

async function recordUsage(tx: Tx, job: { tenant_id: string; interview_id: string }, call: ScoreCall, batch: boolean, billedTo: string) {
  await tx`INSERT INTO usage_ledger (tenant_id, interview_id, kind, model, batch, input_tokens, output_tokens, cost_inr, billed_to)
           VALUES (${job.tenant_id}, ${job.interview_id}, 'scoring', ${call.model}, ${batch}, ${call.usage.input_tokens},
                   ${call.usage.output_tokens}, ${costInr(call.usage, batch)}, ${billedTo})`;
}

/**
 * Checks a reply and stores it as this pass's score. Returns 'retry' when a quote couldn't be found and a
 * re-score is still allowed, so the caller scores again instead of saving.
 */
async function handleReply(tx: Tx, job: Job, loaded: Loaded, call: ScoreCall): Promise<'saved' | 'retry'> {
  let computed: ComputedScore;
  const parsed = aiReply.parse(JSON.parse(call.content));
  computed = computeScore(parsed, loaded.answers, loaded.rubric, loaded.language);
  if (computed.quoteFailures > 0 && job.quote_retries < QUOTE_RETRIES) return 'retry';
  if (computed.quoteFailures > 0) computed = { ...computed, flags: [...computed.flags, { type: 'quote_unverified', detail: `${computed.quoteFailures} supporting quotes were not found in the transcript.` }] };
  await tx`
    INSERT INTO scores (tenant_id, interview_id, pass, model, prompt_version, rubric_id, dimensions, answers, total, summary, strengths, concerns, quote_failures)
    VALUES (${job.tenant_id}, ${job.interview_id}, ${job.pass}, ${call.model}, ${PROMPT_VERSION}, ${loaded.rubricId},
            ${tx.json(computed.dimensions)}, ${tx.json({ answers: computed.answers, flags: computed.flags } as never)}, ${computed.total},
            ${parsed.summary}, ${tx.json(parsed.strengths)}, ${tx.json(parsed.concerns)}, ${computed.quoteFailures})
    ON CONFLICT (interview_id, pass) DO NOTHING`;
  await tx`UPDATE scoring_jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = ${job.id}`;
  await finalize(tx, job.interview_id, loaded.cutoff, job.mode);
  return 'saved';
}

/** After a pass: ask for a second opinion on close calls, otherwise set the final score and review flags. */
export async function finalize(tx: Tx, interviewId: string, cutoff: number, mode: string) {
  const passes = await tx`SELECT pass, total, dimensions, answers FROM scores WHERE interview_id = ${interviewId} ORDER BY pass`;
  const [p1, p2] = passes;
  if (!p2 && isCloseCall(Number(p1.total), cutoff)) {
    await tx`INSERT INTO scoring_jobs (tenant_id, interview_id, pass, mode)
             SELECT tenant_id, id, 2, ${mode}::scoring_mode FROM interviews WHERE id = ${interviewId}
             ON CONFLICT (interview_id, pass) DO NOTHING`;
    await tx`UPDATE interviews SET score_status = 'scoring' WHERE id = ${interviewId}`;
    return;
  }
  const flags = [...(p1.answers.flags ?? [])];
  if (p2) {
    for (const f of p2.answers.flags ?? []) if (f.type === 'quote_unverified') flags.push(f);
    if (passesDisagree(p1.dimensions, p2.dimensions)) {
      flags.push({ type: 'passes_disagree', detail: 'Two independent scorings differ by more than 1 point on a dimension near the shortlist cut-off. A recruiter should decide.' });
    }
  } else if (isCloseCall(Number(p1.total), cutoff)) {
    flags.push({ type: 'close_call', detail: 'Within 5 points of the shortlist cut-off.' });
  }
  const final = p2 ? Math.round(((Number(p1.total) + Number(p2.total)) / 2) * 10) / 10 : Number(p1.total);
  await tx`UPDATE interviews SET final_score = ${final}, score_flags = ${tx.json(flags)},
           score_status = ${flags.length ? 'needs_review' : 'scored'} WHERE id = ${interviewId}`;
}

// ---------- running jobs ----------

type Job = { id: number; tenant_id: string; interview_id: string; pass: number; mode: 'fast' | 'batch'; status: string; attempts: number; quote_retries: number; batch_id: string | null };

async function failOrRetry(tx: Tx, job: Job, error: string) {
  const failed = job.attempts >= MAX_ATTEMPTS;
  await tx`UPDATE scoring_jobs SET status = ${failed ? 'failed' : 'queued'}, error = ${error.slice(0, 1000)}, batch_id = NULL,
           leased_until = NULL, finished_at = ${failed ? new Date() : null} WHERE id = ${job.id}`;
  if (failed) await tx`UPDATE interviews SET score_status = 'failed' WHERE id = ${job.interview_id}`;
}

/** Takes one Fast job (or an expired one) and scores it. Returns false when there was nothing to do. */
export async function runOneFastJob(): Promise<boolean> {
  const job = await asPlatform(async tx => {
    const [j] = await tx`
      UPDATE scoring_jobs SET status = 'running', attempts = attempts + 1, leased_until = now() + interval '10 minutes'
      WHERE id = (SELECT id FROM scoring_jobs
                  WHERE mode = 'fast' AND (status = 'queued' OR (status = 'running' AND leased_until < now()))
                  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`;
    if (j) await tx`UPDATE interviews SET score_status = 'scoring' WHERE id = ${j.interview_id}`;
    return j as unknown as Job | undefined;
  });
  if (!job) return false;
  const { loaded, billing } = await asPlatform(async tx => ({ loaded: await loadScoringInput(tx, job.interview_id), billing: await billingFor(tx, job.tenant_id) }));
  let quoteRetries = 0;
  try {
    for (;;) {
      if (!billing.apiKey && process.env.SCORING_PROVIDER !== 'fake') throw new Error('No OpenAI API key configured');
      const call = await scoreFast(loaded.input, billing.apiKey ?? '');
      const outcome = await asPlatform(async tx => {
        await recordUsage(tx, job, call, false, billing.billedTo);
        return handleReply(tx, { ...job, quote_retries: quoteRetries }, loaded, call);
      });
      if (outcome === 'saved') return true;
      quoteRetries++;
    }
  } catch (e) {
    await asPlatform(tx => failOrRetry(tx, job, (e as Error).message));
    return true;
  }
}

/** Sends queued Batch jobs to OpenAI (grouped by whose key pays) and collects finished batches. */
export async function runBatches() {
  const jobs = await asPlatform(tx => tx`
    SELECT * FROM scoring_jobs WHERE mode = 'batch' AND status IN ('queued', 'submitted') ORDER BY created_at LIMIT ${BATCH_SIZE * 5}`) as unknown as Job[];
  // Submit new ones, one batch per paying key.
  const groups = new Map<string, { billing: Billing; jobs: Job[] }>();
  for (const job of jobs.filter(j => j.status === 'queued')) {
    const billing = await asPlatform(tx => billingFor(tx, job.tenant_id));
    const key = billing.billedTo === 'tenant' ? job.tenant_id : 'platform';
    if (!groups.has(key)) groups.set(key, { billing, jobs: [] });
    if (groups.get(key)!.jobs.length < BATCH_SIZE) groups.get(key)!.jobs.push(job);
  }
  for (const { billing, jobs: group } of groups.values()) {
    if (!billing.apiKey && process.env.SCORING_PROVIDER !== 'fake') continue;
    const items = await asPlatform(async tx => Promise.all(group.map(async j => ({ customId: String(j.id), input: (await loadScoringInput(tx, j.interview_id)).input }))));
    const batchId = await submitBatch(items, billing.apiKey ?? '');
    await asPlatform(tx => tx`UPDATE scoring_jobs SET status = 'submitted', batch_id = ${batchId}, attempts = attempts + 1 WHERE id IN ${tx(group.map(j => j.id))}`);
    await asPlatform(tx => tx`UPDATE interviews SET score_status = 'scoring' WHERE id IN ${tx(group.map(j => j.interview_id))}`);
  }
  // Collect finished batches.
  const submitted = await asPlatform(tx => tx`SELECT * FROM scoring_jobs WHERE status = 'submitted' ORDER BY id`) as unknown as Job[];
  const byBatch = new Map<string, Job[]>();
  for (const j of submitted) byBatch.set(j.batch_id!, [...(byBatch.get(j.batch_id!) ?? []), j]);
  for (const [batchId, batchJobs] of byBatch) {
    const billing = await asPlatform(tx => billingFor(tx, batchJobs[0].tenant_id));
    const loaded = new Map(await asPlatform(async tx => Promise.all(batchJobs.map(async j => [String(j.id), await loadScoringInput(tx, j.interview_id)] as const))));
    const results = await collectBatch(batchId, billing.apiKey ?? '', new Map([...loaded].map(([k, v]) => [k, v.input])));
    if (!results) continue;   // still running
    for (const job of batchJobs) {
      const r = results.find(x => x.customId === String(job.id));
      const l = loaded.get(String(job.id))!;
      await asPlatform(async tx => {
        if (!r?.result) return failOrRetry(tx, job, r?.error ?? 'Missing from batch output');
        await recordUsage(tx, job, r.result, true, billing.billedTo);
        try {
          // A quote that isn't in the transcript gets one quick Fast re-score instead of another 24 h batch.
          if ((await handleReply(tx, { ...job, quote_retries: 0 }, l, r.result)) === 'retry') {
            await tx`UPDATE scoring_jobs SET mode = 'fast', status = 'queued', batch_id = NULL WHERE id = ${job.id}`;
          }
        } catch (e) { await failOrRetry(tx, job, (e as Error).message); }
      });
    }
  }
}

export async function closePool() { await sql.end(); }
