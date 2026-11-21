// Creates (or resets) the platform owner account and prints a one-time link to set its password.
//   npm run create-super-admin -- you@company.com "Your Name"
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Usage: npm run create-super-admin -- <email> "<name>"');
  process.exit(1);
}
const ssl = process.env.DATABASE_SSL as 'require' | 'verify-full' | undefined;
const sql = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, ...(ssl ? { ssl } : {}) });
const token = randomBytes(32).toString('base64url');

const [user] = await sql`
  INSERT INTO users (email, name, is_super_admin, platform_role) VALUES (${email.toLowerCase()}, ${name}, true, 'owner')
  ON CONFLICT (email) DO UPDATE SET is_super_admin = true, platform_role = 'owner', name = EXCLUDED.name
  RETURNING id`;
await sql`UPDATE password_tokens SET used_at = now() WHERE user_id = ${user.id} AND used_at IS NULL`;
await sql`INSERT INTO password_tokens (token_hash, user_id, expires_at)
          VALUES (${createHash('sha256').update(token).digest('hex')}, ${user.id}, now() + interval '1 day')`;
await sql`INSERT INTO audit_log (actor_user_id, action, target) VALUES (${user.id}, 'super_admin.created_by_script', ${email})`;
await sql.end();

console.log(`Super Admin ready: ${email}`);
console.log(`Set the password within 24 hours: ${process.env.APP_URL}/set-password?token=${token}`);
