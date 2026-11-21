import { z } from 'zod';
import { asWorker, authenticateWorker, failJob, saveResult } from '@/lib/worker-api';

const result = z.object({
  transcript: z.string().max(20000),
  language: z.string().min(2).max(5),
  model: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
  metrics: z.object({
    duration_seconds: z.number().min(0), speech_seconds: z.number().min(0), pause_count: z.number().int().min(0),
    long_pauses: z.number().int().min(0), words: z.number().int().min(0), words_per_minute: z.number().min(0),
    filler_count: z.number().int().min(0), fillers: z.record(z.string(), z.number().int().min(0)),
  }),
});
const failure = z.object({ error: z.string().min(1).max(2000) });

// POST /api/worker/jobs/<id>/result  { transcript, language, model, confidence, metrics }  or  { error }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const worker = await authenticateWorker(req);
  if (!worker) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const jobId = Number((await params).id) || 0;
  const body = await req.json().catch(() => null);

  const f = failure.safeParse(body);
  if (f.success) {
    const status = await asWorker(tx => failJob(tx, jobId, worker.id, f.data.error));
    return status ? Response.json({ status }) : Response.json({ error: 'not_leased' }, { status: 409 });
  }
  const r = result.safeParse(body);
  if (!r.success) return Response.json({ error: 'invalid', issues: r.error.issues.slice(0, 5) }, { status: 400 });
  const saved = await asWorker(tx => saveResult(tx, jobId, worker.id, r.data));
  return saved ? Response.json({ status: 'done' }) : Response.json({ error: 'not_leased' }, { status: 409 });
}
