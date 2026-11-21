'use server';

import { redirect } from 'next/navigation';
import { sql, withContext } from '@/db';
import { audit } from '@/lib/audit';
import { clientInfo, endOtherSessions, hashPassword, passwordProblem, requireUser, verifyPassword } from '@/lib/auth';
import { allowAttempt, clearAttempts } from '@/lib/rate-limit';
import { createRecoveryCodes, stashRecoveryCodes } from '@/lib/totp';

const logPlatform = async (e: Parameters<typeof audit>[1]) => withContext({}, tx => audit(tx, e));

/** Re-checks the password before a sensitive change, so an unlocked, unattended screen isn't enough. */
async function confirmPassword(userId: string, form: FormData) {
  if (!(await allowAttempt('reauth:' + userId, 5, 900))) redirect('/account?error=too_many');
  const [u] = await sql`SELECT password_hash FROM users WHERE id = ${userId}`;
  if (!(await verifyPassword(String(form.get('current') ?? ''), u?.password_hash))) redirect('/account?error=wrong_password');
  await clearAttempts('reauth:' + userId);
}

export async function changePassword(form: FormData) {
  const { user } = await requireUser();
  const password = String(form.get('password') ?? '');
  if (password !== form.get('confirm')) redirect('/account?error=mismatch');
  if (passwordProblem(password)) redirect('/account?error=weak');
  await confirmPassword(user.id, form);
  await sql`UPDATE users SET password_hash = ${await hashPassword(password)} WHERE id = ${user.id}`;
  await sql`UPDATE password_tokens SET used_at = now() WHERE user_id = ${user.id} AND used_at IS NULL`;
  await endOtherSessions(user.id);
  await logPlatform({ actorUserId: user.id, action: 'auth.password_changed', ip: (await clientInfo()).ip });
  redirect('/account?msg=password_changed');
}

export async function newBackupCodes(form: FormData) {
  const { user } = await requireUser();
  if (!user.totp_enabled) redirect('/account');
  await confirmPassword(user.id, form);
  await stashRecoveryCodes(user.id, await createRecoveryCodes(user.id));
  await logPlatform({ actorUserId: user.id, action: 'auth.recovery_codes_created', ip: (await clientInfo()).ip });
  redirect('/setup-2fa/backup-codes');
}

/** Moves 2-step login to a new phone: the old app's codes and the backup codes stop working. */
export async function moveToNewPhone(form: FormData) {
  const { user } = await requireUser();
  if (!user.totp_enabled) redirect('/account');
  await confirmPassword(user.id, form);
  await sql.begin(async tx => {
    await tx`UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = ${user.id}`;
    await tx`DELETE FROM recovery_codes WHERE user_id = ${user.id}`;
    await tx`UPDATE sessions SET two_factor_passed = false WHERE user_id = ${user.id}`;
  });
  await endOtherSessions(user.id);
  await logPlatform({ actorUserId: user.id, action: 'auth.2fa_reset_by_user', ip: (await clientInfo()).ip });
  redirect('/setup-2fa');
}
