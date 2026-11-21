'use server';

import { revalidatePath } from 'next/cache';
import { parseSheet, type SheetError } from '@/lib/question-sheet';
import { tenantAction, tenantLimits } from '@/lib/tenant';

export type UploadState =
  | { status: 'idle' }
  | { status: 'errors'; errors: SheetError[] }
  | { status: 'saved'; bankId: string; version: number; questions: number; objections: number; languages: string[] };

const MAX_BYTES = 5 * 1024 * 1024;

/** Validates the whole sheet first; saves a new version only if every row is valid. */
export async function uploadBank(slug: string, _prev: UploadState, form: FormData): Promise<UploadState> {
  const file = form.get('file');
  const target = String(form.get('bank') ?? '');
  const newName = String(form.get('new_name') ?? '').trim();
  const fail = (message: string): UploadState => ({ status: 'errors', errors: [{ row: null, column: null, message }] });
  if (!(file instanceof File) || file.size === 0) return fail('Choose the Excel file to upload.');
  if (file.size > MAX_BYTES) return fail('The file is larger than 5 MB.');
  if (!file.name.toLowerCase().endsWith('.xlsx')) return fail('Upload an .xlsx file (Excel Workbook).');
  if (target === 'new' && (newName.length < 2 || newName.length > 120)) return fail('Give the new question bank a name (2–120 characters).');

  try {
    return await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
      const { languages } = await tenantLimits(tx, ctx.tenant.id);
      const parsed = await parseSheet(await file.arrayBuffer(), languages);
      if (parsed.errors.length) return { status: 'errors', errors: parsed.errors } as const;

      let bankId = target;
      if (target === 'new') {
        const [b] = await tx`INSERT INTO question_banks (tenant_id, name) VALUES (${ctx.tenant.id}, ${newName})
                             ON CONFLICT (tenant_id, name) DO NOTHING RETURNING id`;
        if (!b) return fail('A question bank with that name already exists; choose it from the list instead.');
        bankId = b.id;
      } else {
        const [b] = await tx`SELECT id FROM question_banks WHERE id = ${bankId}`;
        if (!b) return fail('Choose a question bank.');
      }
      const [v] = await tx`
        INSERT INTO question_bank_versions (tenant_id, bank_id, version, file_name, uploaded_by)
        SELECT ${ctx.tenant.id}, ${bankId}, coalesce(max(version), 0) + 1, ${file.name}, ${ctx.user.id}
        FROM question_bank_versions WHERE bank_id = ${bankId}
        RETURNING id, version`;
      const rows = parsed.rows.map((q, i) => ({
        tenant_id: ctx.tenant.id, version_id: v.id, code: q.code, type: q.type, category: q.category, weight: q.weight,
        texts: q.texts, good_answer: q.good_answer, average_answer: q.average_answer, poor_answer: q.poor_answer,
        must_mention: q.must_mention, knockout: q.knockout, knockout_rule: q.knockout_rule, position: i + 1,
      }));
      await tx`INSERT INTO questions ${tx(rows)}`;
      const questions = rows.filter(r => r.type === 'question').length;
      await log({ action: 'question_bank.uploaded', target: bankId, details: { version: v.version, file: file.name, rows: rows.length } });
      return { status: 'saved', bankId, version: v.version, questions, objections: rows.length - questions, languages: parsed.languages } as const;
    });
  } catch (e) {
    return fail((e as Error).message);
  } finally {
    revalidatePath(`/t/${slug}/banks`);
  }
}
