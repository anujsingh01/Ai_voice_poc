import { generate, generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { sql } from '@/db';
import { randomInt } from 'node:crypto';
import { decrypt, encrypt, sha256 } from './crypto';
import { redis } from './rate-limit';

const ISSUER = 'Interview Platform';

export const newTotpSecret = () => encrypt(generateSecret());

/** Stores a fresh (not yet active) 2-step secret for a user who hasn't finished setting one up. */
export async function ensurePendingTotpSecret(userId: string) {
  const [u] = await sql`
    UPDATE users SET totp_secret = coalesce(totp_secret, ${newTotpSecret()})
    WHERE id = ${userId} AND NOT totp_enabled RETURNING totp_secret`;
  return u?.totp_secret as string | undefined;
}

export async function totpQrDataUrl(sealedSecret: string, email: string) {
  return QRCode.toDataURL(generateURI({ issuer: ISSUER, label: email, secret: decrypt(sealedSecret) }));
}

export const totpManualKey = (sealedSecret: string) => decrypt(sealedSecret).match(/.{1,4}/g)!.join(' ');

/** Checks a 6-digit code (allowing one 30-second step of clock drift); each code works only once. */
export async function checkTotp(userId: string, sealedSecret: string, code: string) {
  const token = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return false;
  const r = await verify({ secret: decrypt(sealedSecret), token, epochTolerance: 30 });
  if (!r.valid) return false;
  const step = (r as { timeStep: number }).timeStep;   // TOTP results carry the matched 30-second step
  return (await redis.set(`totp-used:${userId}:${step}`, '1', 'EX', 180, 'NX')) === 'OK';
}

// Used by tests to produce a valid code.
export const currentTotp = async (sealedSecret: string) => generate({ secret: decrypt(sealedSecret) });

// ---------- Backup codes: for when the phone with the authenticator app is lost ----------

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no 0/o, 1/l/i: easy to read back off paper
const CODE_COUNT = 10;

/** "ABCDE-fghij " → "abcdefghij": what the user typed, the way it was hashed. */
export const normaliseRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

function newRecoveryCode() {
  const chars = Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** Replaces the user's backup codes with 10 new ones and returns them (the only time they're readable). */
export async function createRecoveryCodes(userId: string) {
  const codes = Array.from({ length: CODE_COUNT }, newRecoveryCode);
  await sql.begin(async tx => {
    await tx`DELETE FROM recovery_codes WHERE user_id = ${userId}`;
    await tx`INSERT INTO recovery_codes ${tx(codes.map(c => ({ user_id: userId, code_hash: sha256(normaliseRecoveryCode(c)) })))}`;
  });
  return codes;
}

/** Uses up one backup code. Returns how many are left, or null if the code isn't valid. */
export async function redeemRecoveryCode(userId: string, code: string): Promise<number | null> {
  const n = normaliseRecoveryCode(code);
  if (n.length !== 10) return null;
  const [used] = await sql`UPDATE recovery_codes SET used_at = now()
                           WHERE user_id = ${userId} AND code_hash = ${sha256(n)} AND used_at IS NULL RETURNING id`;
  return used ? remainingRecoveryCodes(userId) : null;
}

export async function remainingRecoveryCodes(userId: string) {
  const [r] = await sql`SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = ${userId} AND used_at IS NULL`;
  return r.n as number;
}

// New codes are handed from the action that made them to the page that shows them through a short-lived,
// encrypted, read-once Redis entry, so they never sit in a URL or in the database in readable form.
export async function stashRecoveryCodes(userId: string, codes: string[]) {
  await redis.set(`recovery-show:${userId}`, encrypt(codes.join(',')), 'EX', 600);
}

export async function takeStashedRecoveryCodes(userId: string): Promise<string[] | null> {
  const sealed = await redis.getdel(`recovery-show:${userId}`);
  return sealed ? decrypt(sealed).split(',') : null;
}
