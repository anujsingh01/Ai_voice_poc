import { getObject } from '@/lib/storage';
import { asWorker, authenticateWorker } from '@/lib/worker-api';

// The answer audio for a job this worker currently holds the lease on.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const worker = await authenticateWorker(req);
  if (!worker) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const [a] = await asWorker(tx => tx`
    SELECT a.storage_key, a.mime_type FROM transcription_jobs j JOIN answers a ON a.id = j.answer_id
    WHERE j.id = ${Number(id) || 0} AND j.worker_id = ${worker.id} AND j.status = 'leased'`);
  if (!a) return Response.json({ error: 'not_leased' }, { status: 404 });
  const data = await getObject(a.storage_key);
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': a.mime_type, 'Content-Length': String(data.length) } });
}
