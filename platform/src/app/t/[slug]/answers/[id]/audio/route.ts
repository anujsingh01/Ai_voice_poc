import { getObject } from '@/lib/storage';
import { inTenant, loadTenant } from '@/lib/tenant';

// A candidate's recorded answer, for members of the tenant that owns it (RLS-scoped lookup).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const ctx = await loadTenant(slug);
  const [a] = await inTenant(ctx, tx => tx`SELECT storage_key, mime_type FROM answers WHERE id = ${id}`);
  if (!a) return new Response('Not found', { status: 404 });
  const data = await getObject(a.storage_key);
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': a.mime_type, 'Content-Length': String(data.length), 'Cache-Control': 'private, no-store' },
  });
}
