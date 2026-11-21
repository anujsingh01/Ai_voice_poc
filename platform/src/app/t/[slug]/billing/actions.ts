'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withContext } from '@/db';
import { audit } from '@/lib/audit';
import { BillingError, cancelSubscription, startSubscription } from '@/lib/billing/billing';
import { clientInfo } from '@/lib/auth';
import { normalisePhone } from '@/lib/candidates';
import { billingDriver } from '@/lib/env';
import { loadTenant } from '@/lib/tenant';

/** Billing stays open to tenant admins while the account is suspended or the trial is over: that's how they fix it. */
async function billingAdmin(slug: string) {
  const ctx = await loadTenant(slug);
  if (ctx.role !== 'tenant_admin') redirect(`/t/${slug}`);
  return { ctx, ip: (await clientInfo()).ip };
}

const detailsSchema = z.object({
  billing_name: z.string().trim().min(2).max(120),
  billing_email: z.string().trim().toLowerCase().email().max(254),
  billing_phone: z.string().trim().max(20).transform(v => (v ? normalisePhone(v) ?? 'invalid' : null)).refine(v => v !== 'invalid'),
  gstin: z.string().trim().toUpperCase().transform(v => v || null).refine(v => v === null || /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/.test(v)),
  billing_address: z.string().trim().max(500).transform(v => v || null),
});

export async function saveBillingDetails(slug: string, form: FormData) {
  const { ctx, ip } = await billingAdmin(slug);
  const d = detailsSchema.safeParse(Object.fromEntries(form));
  if (!d.success) redirect(`/t/${slug}/billing?error=details_invalid#details`);
  await withContext({ superAdmin: true }, async tx => {
    await tx`UPDATE tenants SET ${tx(d.data)}, updated_at = now() WHERE id = ${ctx.tenant.id}`;
    await audit(tx, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: 'billing.details_saved', ip });
  });
  revalidatePath(`/t/${slug}/billing`);
  redirect(`/t/${slug}/billing?msg=details_saved`);
}

export async function choosePlan(slug: string, planId: string) {
  const { ctx, ip } = await billingAdmin(slug);
  if (!billingDriver()) redirect(`/t/${slug}/billing`);
  let url: string;
  try {
    url = await startSubscription(ctx.tenant.id, planId, ctx.user.id, ip);
  } catch (e) {
    if (e instanceof BillingError) redirect(`/t/${slug}/billing?error=${e.code}`);
    throw e;
  }
  redirect(url);   // Razorpay's payment page
}

export async function cancelPlan(slug: string) {
  const { ctx, ip } = await billingAdmin(slug);
  try {
    await cancelSubscription(ctx.tenant.id, ctx.user.id, ip);
  } catch (e) {
    if (e instanceof BillingError) redirect(`/t/${slug}/billing?error=${e.code}`);
    throw e;
  }
  revalidatePath(`/t/${slug}/billing`);
  redirect(`/t/${slug}/billing?msg=cancelled`);
}
