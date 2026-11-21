import { getObject } from '@/lib/storage';
import { inTenant, loadTenant } from '@/lib/tenant';

// Streams one question-audio file to a signed-in member of the tenant that owns it.
// The row lookup runs under the tenant's RLS context, so another tenant's id simply isn't found.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const ctx = await loadTenant(slug);
  const [audio] = await inTenant(ctx, tx => tx`SELECT storage_key, mime_type FROM question_audio WHERE id = ${id}`);
  if (!audio) return new Response('Not found', { status: 404 });
  const data = await getObject(audio.storage_key);
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': audio.mime_type, 'Content-Length': String(data.length), 'Cache-Control': 'private, max-age=300' },
  });
}
