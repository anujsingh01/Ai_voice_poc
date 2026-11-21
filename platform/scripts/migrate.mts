// Applies db/migrations/*.sql in order, once each. Runs as the database owner (DATABASE_ADMIN_URL)
// and makes sure the restricted `app_user` role the app connects as exists.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) throw new Error('DATABASE_ADMIN_URL and DATABASE_URL must be set');

const ssl = process.env.DATABASE_SSL as 'require' | 'verify-full' | undefined;
const sql = postgres(adminUrl, { max: 1, onnotice: () => {}, ...(ssl ? { ssl } : {}) });
const appPassword = decodeURIComponent(new URL(appUrl).password);

await sql`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
      CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$`;
await sql.unsafe(`ALTER ROLE app_user WITH PASSWORD '${appPassword.replaceAll("'", "''")}'`);

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = new Set((await sql`SELECT name FROM schema_migrations`).map(r => r.name));

const dir = join(import.meta.dirname, '..', 'db', 'migrations');
for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) continue;
  await sql.begin(async tx => {
    await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
    await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
  });
  console.log('applied', file);
}
await sql.end();
console.log('migrations up to date');
