'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { randomToken, sha256 } from '@/lib/crypto';
import { resetTwoFactor } from '@/lib/auth';
import { tenantAction, tenantLimits } from '@/lib/tenant';
import type { Tx } from '@/db';

const memberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['tenant_admin', 'recruiter', 'reviewer']),
});

/** Tenant admins and recruiters use seats; reviewers (listen and comment only) don't. */
async function seatsAvailable(tx: Tx, tenantId: string, excludingUserId?: string) {
  const { recruiter_seats } = await tenantLimits(tx, tenantId);
  const [{ n }] = await tx`SELECT count(*)::int AS n FROM memberships
                           WHERE role IN ('tenant_admin', 'recruiter') AND user_id IS DISTINCT FROM ${excludingUserId ?? null}`;
  return n < recruiter_seats;
}

export async function addUser(slug: string, form: FormData) {
  const m = memberSchema.safeParse(Object.fromEntries(form));
  if (!m.success) redirect(`/t/${slug}/users?error=invalid`);
  const result = await tenantAction(slug, 'manageUsers', async (tx, ctx, log) => {
    if (m.data.role !== 'reviewer' && !(await seatsAvailable(tx, ctx.tenant.id))) return 'seats';
    const [u] = await tx`INSERT INTO users (email, name) VALUES (${m.data.email}, ${m.data.name})
                         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`;
    const [exists] = await tx`SELECT 1 FROM memberships WHERE user_id = ${u.id}`;
    if (exists) return 'exists';
    await tx`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${ctx.tenant.id}, ${u.id}, ${m.data.role})`;
    await log({ action: 'member.added', target: m.data.email, details: { role: m.data.role } });
    return 'ok';
  });
  redirect(`/t/${slug}/users?${result === 'ok' ? 'msg=added' : `error=${result}`}`);
}

export async function changeRole(slug: string, membershipId: string, form: FormData) {
  const role = z.enum(['tenant_admin', 'recruiter', 'reviewer']).parse(form.get('role'));
  const result = await tenantAction(slug, 'manageUsers', async (tx, ctx, log) => {
    const [m] = await tx`SELECT user_id, role FROM memberships WHERE id = ${membershipId}`;
    if (!m) return 'invalid';
    if (m.user_id === ctx.user.id) return 'self';
    if (m.role === 'reviewer' && role !== 'reviewer' && !(await seatsAvailable(tx, ctx.tenant.id, m.user_id))) return 'seats';
    await tx`UPDATE memberships SET role = ${role} WHERE id = ${membershipId}`;
    await tx`DELETE FROM sessions WHERE user_id = ${m.user_id}`;   // new permissions apply from next sign-in
    await log({ action: 'member.role_changed', target: m.user_id, details: { from: m.role, to: role } });
    return 'ok';
  });
  revalidatePath(`/t/${slug}/users`);
  redirect(`/t/${slug}/users?${result === 'ok' ? 'msg=saved' : `error=${result}`}`);
}

export async function removeUser(slug: string, membershipId: string) {
  const result = await tenantAction(slug, 'manageUsers', async (tx, ctx, log) => {
    const [m] = await tx`SELECT user_id FROM memberships WHERE id = ${membershipId}`;
    if (!m) return 'invalid';
    if (m.user_id === ctx.user.id) return 'self';
    await tx`DELETE FROM memberships WHERE id = ${membershipId}`;
    await tx`DELETE FROM sessions WHERE user_id = ${m.user_id}`;
    await log({ action: 'member.removed', target: m.user_id });
    return 'ok';
  });
  redirect(`/t/${slug}/users?${result === 'ok' ? 'msg=removed' : `error=${result}`}`);
}

export async function createUserPasswordLink(slug: string, userId: string): Promise<{ link: string } | { error: string }> {
  const token = randomToken();
  try {
    await tenantAction(slug, 'manageUsers', async (tx, ctx, log) => {
      const [m] = await tx`SELECT 1 FROM memberships WHERE user_id = ${userId}`;
      if (!m) throw new Error('Not a member');
      const [{ ok }] = await tx`SELECT user_is_exclusive_to_tenant(${userId}, ${ctx.tenant.id}) AS ok`;
      if (!ok) throw new Error('This person also has access elsewhere; ask the platform administrator to reset their password.');
      await tx`UPDATE password_tokens SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`;
      await tx`INSERT INTO password_tokens (token_hash, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, now() + interval '7 days')`;
      await log({ action: 'user.password_link_created', target: userId });
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { link: `${process.env.APP_URL}/set-password?token=${token}` };
}

/** Lost phone: turns off a colleague's 2-step login so they set it up again at next sign-in. */
export async function resetUserTwoFactor(slug: string, userId: string) {
  const result = await tenantAction(slug, 'manageUsers', async (tx, ctx, log) => {
    if (userId === ctx.user.id) return 'self';
    const [m] = await tx`SELECT 1 FROM memberships WHERE user_id = ${userId}`;
    if (!m) return 'not_member';
    const [{ ok }] = await tx`SELECT user_is_exclusive_to_tenant(${userId}, ${ctx.tenant.id}) AS ok`;
    if (!ok) return 'not_exclusive';
    await resetTwoFactor(tx, userId);
    await log({ action: 'user.2fa_reset', target: userId });
    return 'ok';
  });
  redirect(`/t/${slug}/users?${result === 'ok' ? 'msg=2fa_reset' : `error=${result}`}`);
}
