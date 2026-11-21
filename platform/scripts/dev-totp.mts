// Development only: prints the current 2-step code for a local test account (stands in for a phone app).
//   npm run dev-totp -- superadmin@platform.test
import { createDecipheriv } from 'node:crypto';
import { generate } from 'otplib';
import postgres from 'postgres';

if (process.env.NODE_ENV === 'production') throw new Error('Not for production');
const sql = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1 });
const [u] = await sql`SELECT totp_secret FROM users WHERE email = ${process.argv[2]}`;
await sql.end();
if (!u?.totp_secret) throw new Error('No 2-step secret for that user yet');

const [iv, tag, data] = u.totp_secret.split('.').map((s: string) => Buffer.from(s, 'base64url'));
const d = createDecipheriv('aes-256-gcm', Buffer.from(process.env.DATA_ENCRYPTION_KEY!, 'base64'), iv);
d.setAuthTag(tag);
console.log(await generate({ secret: Buffer.concat([d.update(data), d.final()]).toString('utf8') }));
