'use server';

import { redirect } from 'next/navigation';
import { sql, withContext } from '@/db';
import { audit } from '@/lib/audit';
import {
  clientInfo, createSession, getSession, hashPassword, markSession2faPassed, passwordProblem, verifyPassword,
} from '@/lib/auth';
import { randomToken, sha256 } from '@/lib/crypto';
import { demoAccounts, driverFor } from '@/lib/env';
import { log } from '@/lib/log';
import { deliver } from '@/lib/messaging';
import { allowAttempt, clearAttempts } from '@/lib/rate-limit';
import { checkTotp, createRecoveryCodes, stashRecoveryCodes, redeemRecoveryCode } from '@/lib/totp';

const logPlatform = async (e: Parameters<typeof audit>[1]) => withContext({}, tx => audit(tx, e));

export async function login(form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const { ip } = await clientInfo();

  // 5 tries per account and 30 per address every 15 minutes.
  if (!(await allowAttempt('login:' + email, 5, 900)) || !(await allowAttempt('login-ip:' + ip, 30, 900))) {
    redirect('/login?error=too_many');
  }
  const [user] = await sql`SELECT id, password_hash, disabled FROM users WHERE email = ${email}`;
  const ok = user && !user.disabled && (await verifyPassword(password, user.password_hash));
  if (!ok) {
    await logPlatform({ actorUserId: user?.id, action: 'auth.login_failed', target: email, ip });
    redirect('/login?error=invalid');
  }
  await clearAttempts('login:' + email);
  await createSession(user.id, false);
  await logPlatform({ actorUserId: user.id, action: 'auth.login', ip });
  redirect('/');
}

/** One-click sign-in as a DEV_* test account (DEMO_LOGINS=on, this computer only). Skips 2-step login. */
export async function demoLogin(form: FormData) {
  const account = demoAccounts().find(a => a.key === form.get('account'));
  if (!account) redirect('/login');
  const [user] = await sql`SELECT id FROM users WHERE email = ${account.email} AND NOT disabled`;
  if (!user) redirect('/login?error=no_demo_user');
  await createSession(user.id, true);
  await logPlatform({ actorUserId: user.id, action: 'auth.demo_login', target: account.key, ip: (await clientInfo()).ip });
  redirect('/');
}

export async function verifyCode(form: FormData) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (!s.user.totp_secret || !s.user.totp_enabled) redirect('/setup-2fa');
  if (!(await allowAttempt('2fa:' + s.user.id, 5, 300))) redirect('/login/verify?error=too_many');
  const code = String(form.get('code') ?? '');
  const { ip } = await clientInfo();
  // Six digits: the authenticator app. Anything else: one of the printed backup codes.
  if (/^\s*\d{3}\s?\d{3}\s*$/.test(code)) {
    if (!(await checkTotp(s.user.id, s.user.totp_secret, code))) redirect('/login/verify?error=invalid');
    await clearAttempts('2fa:' + s.user.id);
    await markSession2faPassed();
    await logPlatform({ actorUserId: s.user.id, action: 'auth.2fa_passed', ip });
    redirect('/');
  }
  const left = await redeemRecoveryCode(s.user.id, code);
  if (left === null) redirect('/login/verify?error=invalid');
  await clearAttempts('2fa:' + s.user.id);
  await markSession2faPassed();
  await logPlatform({ actorUserId: s.user.id, action: 'auth.recovery_code_used', target: `${left} left`, ip });
  redirect('/account?msg=recovery_used');
}

export async function enable2fa(form: FormData) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.user.totp_enabled) redirect('/');
  if (!(await allowAttempt('2fa:' + s.user.id, 5, 300))) redirect('/setup-2fa?error=too_many');
  if (!s.user.totp_secret || !(await checkTotp(s.user.id, s.user.totp_secret, String(form.get('code') ?? '')))) {
    redirect('/setup-2fa?error=invalid');
  }
  await sql`UPDATE users SET totp_enabled = true WHERE id = ${s.user.id}`;
  await markSession2faPassed();
  await stashRecoveryCodes(s.user.id, await createRecoveryCodes(s.user.id));
  await logPlatform({ actorUserId: s.user.id, action: 'auth.2fa_enabled', ip: (await clientInfo()).ip });
  redirect('/setup-2fa/backup-codes');
}

export async function setPassword(form: FormData) {
  const token = String(form.get('token') ?? '');
  const password = String(form.get('password') ?? '');
  const back = (e: string) => redirect(`/set-password?token=${encodeURIComponent(token)}&error=${e}`);
  if (password !== form.get('confirm')) back('mismatch');
  if (passwordProblem(password)) back('weak');

  const hash = await hashPassword(password);
  const [row] = await sql`
    UPDATE password_tokens SET used_at = now()
    WHERE token_hash = ${sha256(token)} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id`;
  if (!row) back('expired');
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${row.user_id}`;
  await sql`DELETE FROM sessions WHERE user_id = ${row.user_id}`;   // sign out everywhere after a reset
  await logPlatform({ actorUserId: row.user_id, action: 'auth.password_set', ip: (await clientInfo()).ip });
  redirect('/login?msg=password_set');
}

const RESET_MINUTES = 60;

/**
 * "Forgot password": emails a one-time set-password link valid for an hour. The answer is the same
 * whether or not the address has an account, so the page can't be used to find out who has one.
 * The link is built from APP_URL, never from the request's Host header.
 */
export async function requestPasswordReset(form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 254);
  const { ip } = await clientInfo();
  if (!driverFor('email')) redirect('/forgot-password');
  if (!(await allowAttempt('reset-ip:' + ip, 10, 3600))) redirect('/forgot-password?error=too_many');
  // Per address, quietly: going over just stops the emails, so the limit doesn't reveal the account.
  const allowed = await allowAttempt('reset:' + email, 3, 3600);

  const [user] = await sql`SELECT id, name FROM users WHERE email = ${email} AND NOT disabled`;
  if (user && allowed) {
    const token = randomToken();
    await sql.begin(async tx => {
      await tx`UPDATE password_tokens SET used_at = now() WHERE user_id = ${user.id} AND used_at IS NULL`;
      await tx`INSERT INTO password_tokens (token_hash, user_id, expires_at)
               VALUES (${sha256(token)}, ${user.id}, now() + make_interval(mins => ${RESET_MINUTES}))`;
    });
    const link = `${process.env.APP_URL}/set-password?token=${token}`;
    try {
      await deliver({
        channel: 'email', to: email, template: 'password_reset',
        subject: 'Reset your InterviewPlatform password',
        body: `Hi ${user.name.split(/\s+/)[0]},\n\nSomeone (hopefully you) asked to reset the password for this account. To choose a new password, open this link within 1 hour:\n\n${link}\n\nIf it wasn't you, ignore this email: your password stays the same. 2-step login is not affected either way.\n\nInterviewPlatform`,
      });
    } catch (e) {
      log.error('password reset email failed', e);
    }
    await logPlatform({ actorUserId: user.id, action: 'auth.password_reset_requested', ip });
  }
  redirect('/forgot-password?msg=sent');
}
