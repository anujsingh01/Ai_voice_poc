'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withContext } from '@/db';
import { audit } from '@/lib/audit';
import { clientInfo, resetTwoFactor } from '@/lib/auth';
import { applyPlan } from '@/lib/plans';
import { requirePlatform } from '@/lib/platform';
import { randomToken, sha256 } from '@/lib/crypto';
import { LANGUAGE_CODES } from '@/lib/languages';

const asSuper = async <T,>(fn: Parameters<typeof withContext<T>>[1]) => withContext({ superAdmin: true }, fn);

const limitsSchema = z.object({
  interviews_per_month: z.coerce.number().int().min(0).max(1_000_000),
  concurrent_jobs: z.coerce.number().int().min(0).max(1000),
  recruiter_seats: z.coerce.number().int().min(0).max(10_000),
  ai_budget_inr: z.coerce.number().int().min(0).max(10_000_000),
  retention_days: z.coerce.number().int().min(1).max(730),
  scoring_mode: z.enum(['fast', 'batch']),
  own_openai_key: z.coerce.boolean(),
  languages: z.array(z.enum(LANGUAGE_CODES as [string, ...string[]])).min(1),
});

const tenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  status: z.enum(['active', 'trial', 'suspended']),
  trial_ends_at: z.string().optional().transform(v => (v ? new Date(v + 'T23:59:59+05:30') : null)),
}).refine(t => t.status !== 'trial' || t.trial_ends_at, { message: 'trial_end' });

const memberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['tenant_admin', 'recruiter', 'reviewer']),
});

function readLimits(form: FormData) {
  return limitsSchema.safeParse({
    ...Object.fromEntries(form),
    own_openai_key: form.get('own_openai_key') === 'on',
    languages: form.getAll('languages'),
  });
}

/** Adds a user (creating the account if new) to a tenant. Returns the user id. */
async function addMemberTx(tx: Parameters<Parameters<typeof withContext>[1]>[0], tenantId: string, m: z.infer<typeof memberSchema>) {
  const [u] = await tx`
    INSERT INTO users (email, name) VALUES (${m.email}, ${m.name})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id, is_super_admin`;
  // Keep platform staff out of tenants: a tenant membership must never become a path to a staff account.
  if (u.is_super_admin) throw new Error('staff_account');
  await tx`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${tenantId}, ${u.id}, ${m.role})
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
  return u.id as string;
}

export async function createTenant(form: FormData) {
  const { user } = await requirePlatform('manageTenants');
  const { ip } = await clientInfo();
  const slug = String(form.get('slug') ?? '').trim().toLowerCase();
  const planId = String(form.get('plan_id') ?? '');
  const status = form.get('status') === 'trial' ? 'trial' : 'active';
  const name = z.string().trim().min(2).max(120).safeParse(form.get('name'));
  const admin = memberSchema.safeParse({
    email: form.get('admin_email'), name: form.get('admin_name'), role: 'tenant_admin',
  });
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) redirect('/super/tenants/new?error=slug');
  if (!name.success || !admin.success || !/^[0-9a-f-]{36}$/.test(planId)) redirect('/super/tenants/new?error=invalid');

  let id: string;
  try {
    id = await asSuper(async tx => {
      const [plan] = await tx`SELECT name, trial_days FROM plans WHERE id = ${planId} AND NOT archived`;
      if (!plan) throw Object.assign(new Error('plan'), { code: 'plan' });
      // A trial runs for the plan's trial length (at least 7 days if the plan has none).
      const trialEnds = status === 'trial' ? new Date(Date.now() + Math.max(plan.trial_days, 7) * 864e5) : null;
      const [t] = await tx`
        INSERT INTO tenants (name, slug, status, trial_ends_at) VALUES (${name.data}, ${slug}, ${status}, ${trialEnds})
        RETURNING id`;
      await applyPlan(tx, t.id, planId, user.id);
      await addMemberTx(tx, t.id, admin.data);
      await audit(tx, { tenantId: t.id, actorUserId: user.id, action: 'tenant.created', target: slug,
                        details: { name: name.data, status, plan: plan.name, admin: admin.data.email }, ip });
      return t.id as string;
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') redirect('/super/tenants/new?error=slug_taken');
    if (code === 'plan') redirect('/super/tenants/new?error=invalid');
    if ((e as Error).message === 'staff_account') redirect('/super/tenants/new?error=staff_account');
    throw e;
  }
  redirect(`/super/tenants/${id}?msg=created`);
}

export async function updateTenant(id: string, form: FormData) {
  const { user } = await requirePlatform('assignPlans');
  const t = tenantSchema.safeParse(Object.fromEntries(form));
  if (!t.success) redirect(`/super/tenants/${id}?error=invalid`);
  await asSuper(async tx => {
    const [before] = await tx`SELECT name, status, trial_ends_at FROM tenants WHERE id = ${id}`;
    // A status set by staff is a staff decision: a later payment won't undo a staff suspension.
    await tx`UPDATE tenants SET name = ${t.data.name}, status = ${t.data.status}, trial_ends_at = ${t.data.trial_ends_at},
             suspended_for_billing = suspended_for_billing AND status = ${t.data.status}, updated_at = now() WHERE id = ${id}`;
    const action = before.status !== t.data.status
      ? (t.data.status === 'suspended' ? 'tenant.suspended' : before.status === 'suspended' ? 'tenant.reactivated' : 'tenant.updated')
      : 'tenant.updated';
    if (t.data.status === 'suspended') await tx`DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM memberships WHERE tenant_id = ${id})
                                                 AND user_id NOT IN (SELECT id FROM users WHERE is_super_admin)`;
    await audit(tx, { tenantId: id, actorUserId: user.id, action, details: { before, after: t.data }, ip: (await clientInfo()).ip });
  });
  revalidatePath(`/super/tenants/${id}`);
  redirect(`/super/tenants/${id}?msg=saved`);
}

export async function updateLimits(id: string, form: FormData) {
  const { user } = await requirePlatform('manageTenants');
  const l = readLimits(form);
  if (!l.success) redirect(`/super/tenants/${id}?error=invalid`);
  await asSuper(async tx => {
    const [before] = await tx`SELECT * FROM tenant_limits WHERE tenant_id = ${id}`;
    const d = l.data;
    await tx`
      UPDATE tenant_limits SET interviews_per_month = ${d.interviews_per_month}, concurrent_jobs = ${d.concurrent_jobs},
        recruiter_seats = ${d.recruiter_seats}, languages = ${d.languages}, ai_budget_inr = ${d.ai_budget_inr},
        scoring_mode = ${d.scoring_mode}, retention_days = ${d.retention_days}, own_openai_key = ${d.own_openai_key},
        custom = true, updated_at = now()
      WHERE tenant_id = ${id}`;
    await audit(tx, { tenantId: id, actorUserId: user.id, action: 'tenant.limits_changed', details: { before, after: d }, ip: (await clientInfo()).ip });
  });
  revalidatePath(`/super/tenants/${id}`);
  redirect(`/super/tenants/${id}?msg=saved`);
}

export async function addMember(id: string, form: FormData) {
  const { user } = await requirePlatform('manageTenants');
  const m = memberSchema.safeParse(Object.fromEntries(form));
  if (!m.success) redirect(`/super/tenants/${id}?error=member`);
  try {
    await asSuper(async tx => {
      await addMemberTx(tx, id, m.data);
      await audit(tx, { tenantId: id, actorUserId: user.id, action: 'member.added', target: m.data.email, details: { role: m.data.role }, ip: (await clientInfo()).ip });
    });
  } catch (e) {
    if ((e as Error).message === 'staff_account') redirect(`/super/tenants/${id}?error=staff_account`);
    throw e;
  }
  revalidatePath(`/super/tenants/${id}`);
  redirect(`/super/tenants/${id}?msg=member_added`);
}

export async function removeMember(id: string, membershipId: string) {
  const { user } = await requirePlatform('manageTenants');
  await asSuper(async tx => {
    const [m] = await tx`DELETE FROM memberships WHERE id = ${membershipId} AND tenant_id = ${id}
                         RETURNING (SELECT email FROM users WHERE users.id = memberships.user_id) AS email, user_id`;
    if (m) {
      await tx`DELETE FROM sessions WHERE user_id = ${m.user_id}`;
      await audit(tx, { tenantId: id, actorUserId: user.id, action: 'member.removed', target: m.email, ip: (await clientInfo()).ip });
    }
  });
  revalidatePath(`/super/tenants/${id}`);
}

/** Creates a one-time, 7-day link the user opens to set (or reset) their password. Shown once. */
export async function createPasswordLink(tenantId: string, userId: string): Promise<{ link: string }> {
  const { user } = await requirePlatform('manageTenants');
  const token = randomToken();
  await asSuper(async tx => {
    const [m] = await tx`SELECT u.is_super_admin FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${tenantId} AND m.user_id = ${userId}`;
    if (!m) throw new Error('Not a member of this tenant');
    // Platform staff accounts are reset only from the Staff page (manageStaff), never through a tenant.
    if (m.is_super_admin) throw new Error('Platform staff: reset from the Staff page');
    await tx`UPDATE password_tokens SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`;
    await tx`INSERT INTO password_tokens (token_hash, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, now() + interval '7 days')`;
    await audit(tx, { tenantId, actorUserId: user.id, action: 'user.password_link_created', target: userId, ip: (await clientInfo()).ip });
  });
  return { link: `${process.env.APP_URL}/set-password?token=${token}` };
}

/** Lost phone: turns off a tenant member's 2-step login so they set it up again at next sign-in. */
export async function resetMemberTwoFactor(tenantId: string, userId: string) {
  const { user } = await requirePlatform('manageTenants');
  await asSuper(async tx => {
    const [m] = await tx`SELECT u.is_super_admin FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${tenantId} AND m.user_id = ${userId}`;
    if (!m || m.is_super_admin) throw new Error('Not a tenant member');
    await resetTwoFactor(tx, userId);
    await audit(tx, { tenantId, actorUserId: user.id, action: 'user.2fa_reset', target: userId, ip: (await clientInfo()).ip });
  });
  redirect(`/super/tenants/${tenantId}?msg=2fa_reset`);
}
