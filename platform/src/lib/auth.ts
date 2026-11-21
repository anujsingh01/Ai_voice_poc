import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql, type Tx } from '@/db';
import { randomToken, sha256 } from './crypto';

const COOKIE = 'sid';
const SESSION_HOURS = 8;         // absolute lifetime
const IDLE_MINUTES = 60;         // signed out after this long without activity

export type User = {
  id: string; email: string; name: string;
  is_super_admin: boolean; platform_role: 'owner' | 'admin' | 'billing' | 'support' | null; totp_enabled: boolean; totp_secret: string | null; disabled: boolean;
};
export type Membership = { tenant_id: string; slug: string; name: string; status: string; role: Role };
export type Role = 'tenant_admin' | 'recruiter' | 'reviewer';

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, hash: string | null) => (hash ? bcrypt.compare(p, hash) : Promise.resolve(false));

/** Minimum password rule: 10+ characters, not all one kind. */
export function passwordProblem(p: string): string | null {
  if (p.length < 10) return 'Use at least 10 characters.';
  if (!/[a-zA-Z]/.test(p) || !/[^a-zA-Z]/.test(p)) return 'Mix letters with numbers or symbols.';
  return null;
}

export async function clientInfo() {
  const h = await headers();
  // The right-most entry is the one our load balancer appended; anything to its left is client-supplied.
  return { ip: h.get('x-forwarded-for')?.split(',').at(-1)?.trim() || null, userAgent: h.get('user-agent') };
}

export async function userMemberships(userId: string): Promise<Membership[]> {
  return (await sql`SELECT * FROM user_memberships(${userId})`) as unknown as Membership[];
}

/** Admins (super admin, tenant admins) must use 2-step login. */
export function requires2fa(user: User, memberships: Membership[]) {
  return user.is_super_admin || memberships.some(m => m.role === 'tenant_admin');
}

export async function createSession(userId: string, twoFactorPassed: boolean) {
  const token = randomToken();
  const { ip, userAgent } = await clientInfo();
  await sql`INSERT INTO sessions (token_hash, user_id, two_factor_passed, expires_at, ip, user_agent)
            VALUES (${sha256(token)}, ${userId}, ${twoFactorPassed},
                    now() + make_interval(hours => ${SESSION_HOURS}), ${ip}, ${userAgent})`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_HOURS * 3600,
    secure: process.env.NODE_ENV === 'production',
  });
}

/** Marks 2-step login done and swaps in a fresh session token, so a token seen before 2FA is worthless after. */
export async function markSession2faPassed() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return;
  const fresh = randomToken();
  const [s] = await sql`UPDATE sessions SET two_factor_passed = true, token_hash = ${sha256(fresh)}
                        WHERE token_hash = ${sha256(token)} RETURNING expires_at`;
  if (!s) return;
  jar.set(COOKIE, fresh, {
    httpOnly: true, sameSite: 'lax', path: '/', expires: new Date(s.expires_at),
    secure: process.env.NODE_ENV === 'production',
  });
}

/** Ends every other session of this user (after a password or 2-step change), keeping this one. */
export async function endOtherSessions(userId: string) {
  const token = (await cookies()).get(COOKIE)?.value ?? '';
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND token_hash <> ${sha256(token)}`;
}

/**
 * Turns off someone's 2-step login (lost phone and no backup codes), done by an administrator.
 * They're signed out everywhere and must scan a new QR code at their next sign-in.
 */
export async function resetTwoFactor(tx: Tx, userId: string) {
  await tx`UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = ${userId}`;
  await tx`DELETE FROM recovery_codes WHERE user_id = ${userId}`;
  await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
  jar.delete(COOKIE);
}

export async function getSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await sql`
    UPDATE sessions s SET last_seen_at = now()
    FROM users u
    WHERE s.token_hash = ${sha256(token)} AND u.id = s.user_id AND NOT u.disabled
      AND s.expires_at > now() AND s.last_seen_at > now() - make_interval(mins => ${IDLE_MINUTES})
    RETURNING s.two_factor_passed, u.id, u.email, u.name, u.is_super_admin, u.platform_role, u.totp_enabled, u.totp_secret, u.disabled`;
  if (!row) return null;
  const { two_factor_passed, ...user } = row;
  return { user: user as User, twoFactorPassed: two_factor_passed as boolean };
}

/** Signed-in user who has completed 2-step login where required. Redirects otherwise. */
export async function requireUser() {
  const s = await getSession();
  if (!s) redirect('/login');
  const memberships = await userMemberships(s.user.id);
  if (requires2fa(s.user, memberships) && !s.twoFactorPassed) {
    redirect(s.user.totp_enabled ? '/login/verify' : '/setup-2fa');
  }
  return { user: s.user, memberships };
}

export async function requireSuperAdmin() {
  const ctx = await requireUser();
  if (!ctx.user.is_super_admin) redirect('/');
  return ctx;
}

/** Where to send a fully signed-in user. */
export function homeFor(user: User, memberships: Membership[]) {
  if (user.is_super_admin) return '/super';
  if (memberships.length) return `/t/${memberships[0].slug}`;
  return '/no-access';
}
