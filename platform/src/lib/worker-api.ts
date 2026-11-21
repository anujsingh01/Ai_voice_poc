import { sql, withContext, type Tx } from '@/db';
import { sha256 } from './crypto';

// Transcription workers (office GPU PCs) call the platform; the platform never calls them, so no office
// ports are opened. Each worker has its own revocable token.

export const LEASE_MINUTES = 5;
export const MAX_ATTEMPTS = 3;
const LOW_CONFIDENCE = 0.55;
const MIN_SPEECH_SECONDS = 5;

// Product words given to the speech model as hints so brand and product names are spelled right.
export const VOCABULARY = ['Prestige', 'pressure cooker', 'cooker', 'induction', 'cooktop', 'warranty', 'EMI', 'gasket',
  'mixer grinder', 'non-stick', 'kadai', 'tawa', 'service centre', 'exchange offer', 'safety valve'];

export async function authenticateWorker(req: Request) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token.length < 30) return null;
  const [w] = await sql`UPDATE workers SET last_seen_at = now() WHERE token_hash = ${sha256(token)} AND NOT disabled RETURNING id, name`;
  return (w as { id: string; name: string } | undefined) ?? null;
}

/** Worker context: transcription queue rows of every tenant, nothing else is queried here. */
export const asWorker = <T,>(fn: (tx: Tx) => Promise<T>) => withContext({ superAdmin: true }, fn);

export async function leaseJob(tx: Tx, workerId: string) {
  // Jobs whose worker vanished too many times are parked as failed for a person to look at.
  await tx`UPDATE transcription_jobs SET status = 'failed', error = coalesce(error, 'worker lease expired repeatedly'), finished_at = now()
           WHERE status = 'leased' AND leased_until < now() AND attempts >= ${MAX_ATTEMPTS}`;
  const [job] = await tx`
    UPDATE transcription_jobs SET status = 'leased', worker_id = ${workerId}, attempts = attempts + 1,
      leased_until = now() + make_interval(mins => ${LEASE_MINUTES})
    WHERE id = (
      SELECT id FROM transcription_jobs
      WHERE (status = 'queued' OR (status = 'leased' AND leased_until < now())) AND attempts < ${MAX_ATTEMPTS}
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, answer_id, attempts`;
  if (!job) return null;
  const [ctx] = await tx`
    SELECT iv.language, a.duration_ms, a.mime_type, q.must_mention, q.texts ->> iv.language AS question
    FROM answers a JOIN interview_questions iq ON iq.id = a.interview_question_id
    JOIN interviews iv ON iv.id = iq.interview_id JOIN questions q ON q.id = iq.question_id
    WHERE a.id = ${job.answer_id}`;
  return {
    id: Number(job.id), attempt: job.attempts as number, language: ctx.language as string,
    durationMs: ctx.duration_ms as number, mimeType: ctx.mime_type as string,
    hints: [...VOCABULARY, ...((ctx.must_mention as string[]) ?? [])],
    question: ctx.question as string,
    audioPath: `/api/worker/jobs/${job.id}/audio`, leaseMinutes: LEASE_MINUTES,
  };
}

export type TranscriptResult = {
  transcript: string; language: string; model: string; confidence: number;
  metrics: { duration_seconds: number; speech_seconds: number; pause_count: number; long_pauses: number;
             words: number; words_per_minute: number; filler_count: number; fillers: Record<string, number> };
};

export async function saveResult(tx: Tx, jobId: number, workerId: string, r: TranscriptResult) {
  const [job] = await tx`
    UPDATE transcription_jobs SET status = 'done', finished_at = now(), error = NULL
    WHERE id = ${jobId} AND worker_id = ${workerId} AND status = 'leased' RETURNING answer_id`;
  if (!job) return false;   // lease lost (expired and taken by another worker): ignore the late result
  const low = r.confidence < LOW_CONFIDENCE || r.metrics.speech_seconds < MIN_SPEECH_SECONDS;
  await tx`
    UPDATE answers SET transcript = ${r.transcript}, asr_language = ${r.language}, asr_model = ${r.model},
      asr_confidence = ${r.confidence}, low_confidence = ${low}, metrics = ${tx.json(r.metrics)}, transcribed_at = now()
    WHERE id = ${job.answer_id}`;
  return true;
}

export async function failJob(tx: Tx, jobId: number, workerId: string, error: string) {
  const [j] = await tx`
    UPDATE transcription_jobs SET
      status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed'::transcription_status ELSE 'queued'::transcription_status END,
      error = ${error.slice(0, 1000)}, leased_until = NULL,
      finished_at = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN now() END
    WHERE id = ${jobId} AND worker_id = ${workerId} AND status = 'leased' RETURNING status`;
  return j?.status as string | undefined;
}
