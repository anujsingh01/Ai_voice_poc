import { audit } from '@/lib/audit';
import { clientInfo } from '@/lib/auth';
import { languageName } from '@/lib/languages';
import { csvCell, csvPhone, jobResults, readFilter } from '@/lib/results';
import { inTenant, loadTenant } from '@/lib/tenant';

// CSV of the ranked results (with contact details), for recruiters and admins. Every export is audited.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const ctx = await loadTenant(slug);
  if (!ctx.can('manageCandidates')) return new Response('Forbidden', { status: 403 });
  const filter = readFilter(Object.fromEntries(new URL(req.url).searchParams));
  const { ip } = await clientInfo();
  const { job, rows } = await inTenant(ctx, async tx => {
    const [job] = await tx`SELECT title FROM jobs WHERE id = ${id}`;
    const r = await jobResults(tx, id, filter);
    await audit(tx, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: 'results.exported', target: id, details: { ...filter, rows: r.rows.length }, ip });
    return { job, rows: r.rows };
  });
  if (!job) return new Response('Not found', { status: 404 });
  const header = ['Rank', 'Name', 'Phone', 'Email', 'Language', 'Score', 'AI score', 'Override', 'Flags', 'Decision', 'Decision reason', 'Interviewed'];
  const lines = rows.map((r, i) => [
    csvCell(i + 1), csvCell(r.name), csvPhone(r.phone), ...[r.email, languageName(r.language), r.score?.toFixed(1), r.ai_score?.toFixed(1), r.override_score?.toFixed(1),
    r.flags.map(f => f.type).join(' '), r.decision ?? 'undecided', r.decision_reason, new Date(r.completed_at).toISOString().slice(0, 10)].map(csvCell),
  ].join(','));
  const name = `${job.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')}-results.csv`;
  return new Response('﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
}
