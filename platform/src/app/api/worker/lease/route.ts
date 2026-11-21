import { z } from 'zod';
import { sql } from '@/db';
import { asWorker, authenticateWorker, leaseJob } from '@/lib/worker-api';

const info = z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).optional();

// POST /api/worker/lease  (Authorization: Bearer <worker token>)
// Body (optional): { info: { model, device, version, … } } shown in the Super Admin's worker list.
// → 200 { job } with the next answer to transcribe, or 204 when the queue is empty.
export async function POST(req: Request) {
  const worker = await authenticateWorker(req);
  if (!worker) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { info?: unknown };
  const parsed = info.safeParse(body.info);
  if (parsed.success && parsed.data) await sql`UPDATE workers SET info = ${sql.json(parsed.data)} WHERE id = ${worker.id}`;
  const job = await asWorker(tx => leaseJob(tx, worker.id));
  return job ? Response.json({ job }) : new Response(null, { status: 204 });
}
