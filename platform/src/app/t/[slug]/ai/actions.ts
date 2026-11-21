'use server';

import { redirect } from 'next/navigation';
import { encrypt } from '@/lib/crypto';
import { tenantAction, tenantLimits } from '@/lib/tenant';

/** Stores the tenant's own OpenAI key, encrypted. Only possible when the platform owner has allowed it. */
export async function saveOpenAiKey(slug: string, form: FormData) {
  const key = String(form.get('key') ?? '').trim();
  if (!/^sk-[\w-]{20,200}$/.test(key)) redirect(`/t/${slug}/ai?error=key`);
  const result = await tenantAction(slug, 'manageSetup', async (tx, ctx, log) => {
    if (!(await tenantLimits(tx, ctx.tenant.id)).own_openai_key) return 'not_allowed';
    await tx`INSERT INTO tenant_secrets (tenant_id, openai_key_enc, openai_key_hint) VALUES (${ctx.tenant.id}, ${encrypt(key)}, ${key.slice(-4)})
             ON CONFLICT (tenant_id) DO UPDATE SET openai_key_enc = EXCLUDED.openai_key_enc, openai_key_hint = EXCLUDED.openai_key_hint, updated_at = now()`;
    await log({ action: 'ai.own_key_set', details: { hint: key.slice(-4) } });
    return 'ok';
  });
  redirect(`/t/${slug}/ai?${result === 'ok' ? 'msg=saved' : `error=${result}`}`);
}

export async function removeOpenAiKey(slug: string) {
  await tenantAction(slug, 'manageSetup', async (tx, _ctx, log) => {
    await tx`DELETE FROM tenant_secrets WHERE tenant_id = current_tenant_id()`;
    await log({ action: 'ai.own_key_removed' });
  });
  redirect(`/t/${slug}/ai?msg=removed`);
}
