'use server';

import { redirect } from 'next/navigation';
import { tenantAction, tenantLimits } from '@/lib/tenant';

export async function saveConsent(slug: string, form: FormData) {
  const contact = String(form.get('grievance_contact') ?? '').trim();
  if (contact.length < 5 || contact.length > 300) redirect(`/t/${slug}/consent?error=contact`);
  const result = await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
    const { languages } = await tenantLimits(tx, ctx.tenant.id);
    const texts: Record<string, string> = {};
    for (const l of languages) {
      const t = String(form.get(`text_${l}`) ?? '').trim();
      if (t.length > 6000) return 'too_long';
      if (t) texts[l] = t;
    }
    if (!Object.keys(texts).length) return 'empty';
    const [v] = await tx`
      INSERT INTO consent_texts (tenant_id, version, texts, grievance_contact, created_by)
      SELECT ${ctx.tenant.id}, coalesce(max(version), 0) + 1, ${tx.json(texts)}, ${contact}, ${ctx.user.id}
      FROM consent_texts RETURNING version`;
    await log({ action: 'consent.saved', details: { version: v.version, languages: Object.keys(texts) } });
    return 'ok';
  });
  redirect(`/t/${slug}/consent?${result === 'ok' ? 'msg=saved' : `error=${result}`}`);
}
