import { randomUUID } from 'node:crypto';
import { sha256 } from '@/lib/crypto';
import { inInvite, resolveInvite } from '@/lib/interview';
import { allowAttempt } from '@/lib/rate-limit';
import { deleteObject, putObject, sniffAudio, tenantKey } from '@/lib/storage';

const MAX_BYTES = 15 * 1024 * 1024;
const RETRY_WINDOW_SECONDS = 300;

/** Reads the body but stops as soon as it passes `max` bytes (Content-Length can be absent or wrong). */
async function readCapped(req: Request, max: number): Promise<Buffer | null> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Upload of one recorded answer (the raw audio is the request body).
 * ?attempt=1 is the first recording, ?attempt=2 the single allowed re-record. Repeating the same attempt
 * (a retry after a dropped connection) simply replaces the upload, so retries are always safe.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ token: string; position: string }> }) {
  const { token, position } = await params;
  if (!(await allowAttempt('cand-up:' + sha256(token), 120, 3600))) return Response.json({ problem: 'rate_limited' }, { status: 429 });
  const { invite, problem } = await resolveInvite(token);
  if (!invite || problem) return Response.json({ problem }, { status: 409 });

  const url = new URL(req.url);
  const attempt = Number(url.searchParams.get('attempt'));
  const durationMs = Math.round(Number(url.searchParams.get('duration_ms')));
  if (![1, 2].includes(attempt) || !Number.isFinite(durationMs) || durationMs < 1000) return Response.json({ problem: 'invalid' }, { status: 400 });
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return Response.json({ problem: 'too_large' }, { status: 413 });
  const data = await readCapped(req, MAX_BYTES);
  if (!data || data.length === 0) return Response.json({ problem: 'too_large' }, { status: 413 });
  const kind = sniffAudio(data);
  if (!kind) return Response.json({ problem: 'not_audio' }, { status: 415 });

  let oldKey: string | null = null;
  const result = await inInvite(invite, async tx => {
    const [iq] = await tx`
      SELECT iq.id, iv.id AS interview_id, iv.status, iv.answer_seconds, a.id AS answer_id, a.attempt, a.storage_key,
             a.uploaded_at > now() - make_interval(secs => ${RETRY_WINDOW_SECONDS}) AS recent
      FROM interviews iv JOIN interview_questions iq ON iq.interview_id = iv.id AND iq.position = ${Number(position) || 0}
      LEFT JOIN answers a ON a.interview_question_id = iq.id
      WHERE iv.invitation_id = ${invite.invitation_id}`;
    if (!iq) return 'not_found';
    if (iq.status !== 'in_progress') return 'closed';
    if (durationMs > (iq.answer_seconds + 15) * 1000) return 'too_long';
    if (!iq.answer_id && attempt !== 1) return 'invalid';
    if (iq.answer_id && attempt < iq.attempt) return 'already_rerecorded';
    // Sending the same attempt again is a retry after a dropped connection, so only allowed shortly after.
    if (iq.answer_id && attempt === iq.attempt && !iq.recent) return 'already_rerecorded';

    const key = tenantKey(invite.tenant_id, 'answers', iq.interview_id, `${position}-${attempt}-${randomUUID()}.${kind.ext}`);
    await putObject(key, data);
    oldKey = iq.storage_key ?? null;
    const [a] = await tx`
      INSERT INTO answers (tenant_id, interview_question_id, attempt, storage_key, mime_type, size_bytes, duration_ms)
      VALUES (${invite.tenant_id}, ${iq.id}, ${attempt}, ${key}, ${kind.mime}, ${data.length}, ${durationMs})
      ON CONFLICT (interview_question_id) DO UPDATE SET attempt = EXCLUDED.attempt, storage_key = EXCLUDED.storage_key,
        mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes, duration_ms = EXCLUDED.duration_ms, uploaded_at = now(),
        transcript = NULL, asr_language = NULL, asr_model = NULL, asr_confidence = NULL, low_confidence = NULL, metrics = NULL, transcribed_at = NULL
      RETURNING id`;
    // Transcribe straight away, while the candidate answers the next question.
    await tx`
      INSERT INTO transcription_jobs (tenant_id, answer_id) VALUES (${invite.tenant_id}, ${a.id})
      ON CONFLICT (answer_id) DO UPDATE SET status = 'queued', attempts = 0, leased_until = NULL, worker_id = NULL,
        error = NULL, created_at = now(), finished_at = NULL`;
    return 'ok';
  });
  if (result !== 'ok') return Response.json({ problem: result }, { status: result === 'not_found' ? 404 : 409 });
  if (oldKey) await deleteObject(oldKey);
  return Response.json({ ok: true });
}
