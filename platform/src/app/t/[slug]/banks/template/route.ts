import { buildSheet, type QuestionRow } from '@/lib/question-sheet';
import { inTenant, loadTenant, tenantLimits } from '@/lib/tenant';

// GET /t/<slug>/banks/template            → blank template with examples, one text column per enabled language
// GET /t/<slug>/banks/template?bank=<id>  → the bank's latest version, ready to edit and re-upload
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadTenant(slug);
  const bankId = new URL(req.url).searchParams.get('bank');
  const { languages, rows, name } = await inTenant(ctx, async tx => {
    const { languages } = await tenantLimits(tx, ctx.tenant.id);
    if (!bankId || !/^[0-9a-f-]{36}$/.test(bankId)) return { languages, rows: undefined, name: 'question-bank-template' };
    const [bank] = await tx`SELECT name FROM question_banks WHERE id = ${bankId}`;
    const rows = await tx`
      SELECT q.* FROM questions q
      WHERE q.version_id = (SELECT id FROM question_bank_versions WHERE bank_id = ${bankId} ORDER BY version DESC LIMIT 1)
      ORDER BY q.position`;
    return { languages, rows: rows as unknown as QuestionRow[], name: bank?.name ?? 'question-bank' };
  });
  const file = await buildSheet(languages, rows);
  const filename = name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.xlsx';
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
