'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withContext } from '@/db';
import { audit } from '@/lib/audit';
import { clientInfo } from '@/lib/auth';
import { LANGUAGE_CODES } from '@/lib/languages';
import { applyPlan } from '@/lib/plans';
import { requirePlatform } from '@/lib/platform';

const planSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().transform(v => v || null),
  price_inr: z.coerce.number().int().min(0).max(100_000_000),
  billing_period: z.enum(['monthly', 'yearly']),
  trial_days: z.coerce.number().int().min(0).max(90),
  sort_order: z.coerce.number().int().min(0).max(1000),
  interviews_per_month: z.coerce.number().int().min(0).max(1_000_000),
  concurrent_jobs: z.coerce.number().int().min(0).max(1000),
  recruiter_seats: z.coerce.number().int().min(0).max(10_000),
  ai_budget_inr: z.coerce.number().int().min(0).max(10_000_000),
  retention_days: z.coerce.number().int().min(1).max(730),
  scoring_mode: z.enum(['fast', 'batch']),
  own_openai_key: z.boolean(),
  self_serve: z.boolean(),
  languages: z.array(z.enum(LANGUAGE_CODES as [string, ...string[]])).min(1),
});

const readPlan = (form: FormData) => planSchema.safeParse({
  ...Object.fromEntries(form), own_openai_key: form.get('own_openai_key') === 'on', self_serve: form.get('self_serve') === 'on', languages: form.getAll('languages'),
});
const asPlatform = <T,>(fn: Parameters<typeof withContext<T>>[1]) => withContext({ superAdmin: true }, fn);

export async function createPlan(form: FormData) {
  const { user } = await requirePlatform('managePlans');
  const p = readPlan(form);
  if (!p.success) redirect('/super/plans/new?error=invalid');
  let id: string;
  try {
    id = await asPlatform(async tx => {
      const d = p.data;
      const [row] = await tx`INSERT INTO plans ${tx(d)} RETURNING id`;
      await audit(tx, { actorUserId: user.id, action: 'plan.created', target: row.id, details: d, ip: (await clientInfo()).ip });
      return row.id as string;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') redirect('/super/plans/new?error=name_taken');
    throw e;
  }
  redirect(`/super/plans/${id}?msg=created`);
}

/** Saves a plan. With "apply", tenants on this plan without custom limits get the new limits too. */
export async function updatePlan(id: string, form: FormData) {
  const { user } = await requirePlatform('managePlans');
  const p = readPlan(form);
  if (!p.success) redirect(`/super/plans/${id}?error=invalid`);
  const apply = form.get('apply') === 'on';
  let updated = 0;
  try {
    updated = await asPlatform(async tx => {
      const [before] = await tx`SELECT * FROM plans WHERE id = ${id}`;
      await tx`UPDATE plans SET ${tx(p.data)}, updated_at = now() WHERE id = ${id}`;
      let n = 0;
      if (apply) {
        const tenants = await tx`SELECT t.id FROM tenants t JOIN tenant_limits l ON l.tenant_id = t.id WHERE t.plan_id = ${id} AND NOT l.custom`;
        for (const t of tenants) await applyPlan(tx, t.id, id, user.id);
        n = tenants.length;
      }
      await audit(tx, { actorUserId: user.id, action: 'plan.updated', target: id, details: { before, after: p.data, applied_to: n }, ip: (await clientInfo()).ip });
      return n;
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') redirect(`/super/plans/${id}?error=name_taken`);
    throw e;
  }
  revalidatePath('/super/plans');
  redirect(`/super/plans/${id}?msg=${apply ? `applied&n=${updated}` : 'saved'}`);
}

export async function setPlanArchived(id: string, archived: boolean) {
  const { user } = await requirePlatform('managePlans');
  await asPlatform(async tx => {
    await tx`UPDATE plans SET archived = ${archived}, updated_at = now() WHERE id = ${id}`;
    await audit(tx, { actorUserId: user.id, action: archived ? 'plan.archived' : 'plan.restored', target: id, ip: (await clientInfo()).ip });
  });
  revalidatePath('/super/plans');
  redirect(`/super/plans/${id}?msg=${archived ? 'archived' : 'restored'}`);
}

/** Moves a tenant to a plan (its limits become the plan's; custom overrides are dropped). */
export async function assignPlan(tenantId: string, form: FormData) {
  const { user } = await requirePlatform('assignPlans');
  const planId = String(form.get('plan_id') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(planId)) redirect(`/super/tenants/${tenantId}?error=plan`);
  await asPlatform(async tx => {
    const [before] = await tx`SELECT p.name FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = ${tenantId}`;
    const plan = await applyPlan(tx, tenantId, planId, user.id);
    await audit(tx, { tenantId, actorUserId: user.id, action: 'tenant.plan_changed', details: { from: before?.name ?? null, to: plan.name }, ip: (await clientInfo()).ip });
  });
  revalidatePath(`/super/tenants/${tenantId}`);
  redirect(`/super/tenants/${tenantId}?msg=plan`);
}
