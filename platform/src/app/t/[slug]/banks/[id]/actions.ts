'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { deleteObject, putObject, sniffAudio, tenantKey } from '@/lib/storage';
import { tenantAction } from '@/lib/tenant';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export async function saveQuestionAudio(slug: string, bankId: string, code: string, language: string, form: FormData): Promise<{ ok: true } | { error: string }> {
  const file = form.get('audio');
  if (!(file instanceof File) || file.size === 0) return { error: 'No audio received.' };
  if (file.size > MAX_AUDIO_BYTES) return { error: 'Audio is larger than 10 MB.' };
  const data = Buffer.from(await file.arrayBuffer());
  const kind = sniffAudio(data);
  if (!kind) return { error: 'Use an MP3, M4A, WAV, OGG or WebM audio file.' };

  try {
    let oldKey: string | null = null;
    await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
      // The question code must exist in some version of this bank, in a language that bank has text for.
      const [q] = await tx`
        SELECT 1 FROM questions q JOIN question_bank_versions v ON v.id = q.version_id
        WHERE v.bank_id = ${bankId} AND q.code = ${code} AND coalesce(q.texts ->> ${language}, '') <> '' LIMIT 1`;
      if (!q) throw new Error('Question not found.');
      const key = tenantKey(ctx.tenant.id, 'question-audio', bankId, `${code}-${language}-${randomUUID()}.${kind.ext}`);
      await putObject(key, data);
      const [prev] = await tx`SELECT storage_key FROM question_audio WHERE bank_id = ${bankId} AND code = ${code} AND language = ${language}`;
      oldKey = prev?.storage_key ?? null;
      await tx`
        INSERT INTO question_audio (tenant_id, bank_id, code, language, storage_key, mime_type, size_bytes, uploaded_by)
        VALUES (${ctx.tenant.id}, ${bankId}, ${code}, ${language}, ${key}, ${kind.mime}, ${data.length}, ${ctx.user.id})
        ON CONFLICT (bank_id, code, language) DO UPDATE SET storage_key = EXCLUDED.storage_key, mime_type = EXCLUDED.mime_type,
          size_bytes = EXCLUDED.size_bytes, uploaded_by = EXCLUDED.uploaded_by, created_at = now()`;
      await log({ action: 'question_audio.saved', target: `${bankId}/${code}/${language}`, details: { bytes: data.length, mime: kind.mime } });
    });
    if (oldKey) await deleteObject(oldKey);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/t/${slug}/banks/${bankId}`);
  return { ok: true };
}

export async function deleteQuestionAudio(slug: string, bankId: string, audioId: string) {
  const key = await tenantAction(slug, 'manageSetup', async (tx, _ctx, log) => {
    const [a] = await tx`DELETE FROM question_audio WHERE id = ${audioId} AND bank_id = ${bankId} RETURNING storage_key, code, language`;
    if (a) await log({ action: 'question_audio.deleted', target: `${bankId}/${a.code}/${a.language}` });
    return a?.storage_key as string | undefined;
  });
  if (key) await deleteObject(key);
  revalidatePath(`/t/${slug}/banks/${bankId}`);
}
