'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withContext, type Tx } from '@/db';
import { audit } from '@/lib/audit';
import { clientInfo, resetTwoFactor } from '@/lib/auth';
import { randomToken, sha256 } from '@/lib/crypto';
import { requirePlatform } from '@/lib/platform';

const role = z.enum(['owner', 'admin', 'billing', 'support']);
const asPlatform = <T,>(fn: (tx: Tx) => Promise<T>) => withContext({ superAdmin: true }, fn);
const owners = async (tx: Tx) => (await tx`SELECT count(*)::int AS n FROM users WHERE platform_role = 'owner' AND NOT disabled`)[0].n as number;

export async function inviteStaff(form: FormData) {
  const { user } = await requirePlatform('manageStaff');
  const d = z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(120), role }).safeParse(Object.fromEntries(form));
  if (!d.success) redirect('/super/staff?error=invalid');
  const result = await asPlatform(async tx => {
    // Staff and tenant accounts stay separate, so no tenant admin ever manages a staff login.
    const [member] = await tx`SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ${d.data.email} LIMIT 1`;
    if (member) return 'tenant_account';
    await tx`INSERT INTO users (email, name, is_super_admin, platform_role) VALUES (${d.data.email}, ${d.data.name}, true, ${d.data.role})
             ON CONFLICT (email) DO UPDATE SET is_super_admin = true, platform_role = EXCLUDED.platform_role`;
    await audit(tx, { actorUserId: user.id, action: 'staff.invited', target: d.data.email, details: { role: d.data.role }, ip: (await clientInfo()).ip });
    return 'ok';
  });
  if (result !== 'ok') redirect(`/super/staff?error=${result}`);
  revalidatePath('/super/staff');
  redirect('/super/staff?msg=invited');
}

export async function changeStaffRole(userId: string, form: FormData) {
  const { user } = await requirePlatform('manageStaff');
  const r = role.safeParse(form.get('role'));
  if (!r.success || userId === user.id) redirect('/super/staff?error=self');
  const result = await asPlatform(async tx => {
    const [target] = await tx`SELECT platform_role FROM users WHERE id = ${userId} AND is_super_admin`;
    if (!target) return 'invalid';
    if (target.platform_role === 'owner' && r.data !== 'owner' && (await owners(tx)) <= 1) return 'last_owner';
    await tx`UPDATE users SET platform_role = ${r.data} WHERE id = ${userId}`;
    await tx`DELETE FROM sessions WHERE user_id = ${userId}`;   // new rights from their next sign-in
    await audit(tx, { actorUserId: user.id, action: 'staff.role_changed', target: userId, details: { from: target.platform_role, to: r.data }, ip: (await clientInfo()).ip });
    return 'ok';
  });
  revalidatePath('/super/staff');
  redirect(`/super/staff?${result === 'ok' ? 'msg=saved' : `error=${result}`}`);
}

export async function removeStaff(userId: string) {
  const { user } = await requirePlatform('manageStaff');
  if (userId === user.id) redirect('/super/staff?error=self');
  const result = await asPlatform(async tx => {
    const [target] = await tx`SELECT platform_role, email FROM users WHERE id = ${userId} AND is_super_admin`;
    if (!target) return 'invalid';
    if (target.platform_role === 'owner' && (await owners(tx)) <= 1) return 'last_owner';
    await tx`UPDATE users SET is_super_admin = false, platform_role = NULL WHERE id = ${userId}`;
    await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
    await audit(tx, { actorUserId: user.id, action: 'staff.removed', target: target.email, ip: (await clientInfo()).ip });
    return 'ok';
  });
  revalidatePath('/super/staff');
  redirect(`/super/staff?${result === 'ok' ? 'msg=removed' : `error=${result}`}`);
}

export async function createStaffPasswordLink(userId: string): Promise<{ link: string } | { error: string }> {
  const { user } = await requirePlatform('manageStaff');
  const token = randomToken();
  await asPlatform(async tx => {
    const [t] = await tx`SELECT 1 FROM users WHERE id = ${userId} AND is_super_admin`;
    if (!t) throw new Error('Not platform staff');
    await tx`UPDATE password_tokens SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`;
    await tx`INSERT INTO password_tokens (token_hash, user_id, expires_at) VALUES (${sha256(token)}, ${userId}, now() + interval '2 days')`;
    await audit(tx, { actorUserId: user.id, action: 'staff.password_link_created', target: userId, ip: (await clientInfo()).ip });
  });
  return { link: `${process.env.APP_URL}/set-password?token=${token}` };
}

/** Lost phone: turns off a staff member's 2-step login so they set it up again at next sign-in. */
export async function resetStaffTwoFactor(userId: string) {
  const { user } = await requirePlatform('manageStaff');
  if (userId === user.id) redirect('/account');
  await asPlatform(async tx => {
    const [t] = await tx`SELECT 1 FROM users WHERE id = ${userId} AND is_super_admin`;
    if (!t) throw new Error('Not platform staff');
    await resetTwoFactor(tx, userId);
    await audit(tx, { actorUserId: user.id, action: 'staff.2fa_reset', target: userId, ip: (await clientInfo()).ip });
  });
  redirect('/super/staff?msg=2fa_reset');
}
