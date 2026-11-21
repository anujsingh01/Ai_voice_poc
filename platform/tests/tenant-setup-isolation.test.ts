// Isolation and immutability for the tenant-setup tables (jobs, question banks, candidates, invites…).
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
class Rollback extends Error {}

async function as<T>(tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  let result: T;
  await app.begin(async tx => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.is_super_admin', 'off', true)`;
    result = await fn(tx);
    throw new Rollback();
  }).catch(e => { if (!(e instanceof Rollback)) throw e; });
  return result!;
}

const suffix = Date.now().toString(36);
const ids: Record<string, string> = {};

beforeAll(async () => {
  // Tenant B gets one row in every table; tenant A gets nothing.
  [{ id: ids.A }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Setup A', ${'setup-a-' + suffix}) RETURNING id`;
  [{ id: ids.B }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Setup B', ${'setup-b-' + suffix}) RETURNING id`;
  const B = ids.B;
  [{ id: ids.bank }] = await admin`INSERT INTO question_banks (tenant_id, name) VALUES (${B}, 'Bank') RETURNING id`;
  [{ id: ids.version }] = await admin`INSERT INTO question_bank_versions (tenant_id, bank_id, version) VALUES (${B}, ${ids.bank}, 1) RETURNING id`;
  [{ id: ids.question }] = await admin`
    INSERT INTO questions (tenant_id, version_id, code, type, category, weight, texts, good_answer, average_answer, poor_answer, position)
    VALUES (${B}, ${ids.version}, 'Q1', 'question', 'C', 1, '{"en":"x"}', 'g', 'a', 'p', 1) RETURNING id`;
  await admin`INSERT INTO question_audio (tenant_id, bank_id, code, language, storage_key, mime_type, size_bytes)
              VALUES (${B}, ${ids.bank}, 'Q1', 'en', ${`tenants/${B}/x.webm`}, 'audio/webm', 1)`;
  [{ id: ids.job }] = await admin`INSERT INTO jobs (tenant_id, title, languages, bank_id) VALUES (${B}, 'Job', '{en}', ${ids.bank}) RETURNING id`;
  await admin`INSERT INTO rubrics (tenant_id, job_id, version, dimensions, shortlist_cutoff) VALUES (${B}, ${ids.job}, 1, '[]', 60)`;
  await admin`INSERT INTO consent_texts (tenant_id, version, texts, grievance_contact) VALUES (${B}, 1, '{"en":"x"}', 'hr@b')`;
  [{ id: ids.candidate }] = await admin`INSERT INTO candidates (tenant_id, job_id, name, phone) VALUES (${B}, ${ids.job}, 'C', '+919876543210') RETURNING id`;
  await admin`INSERT INTO invitations (tenant_id, candidate_id, token_hash, expires_at) VALUES (${B}, ${ids.candidate}, ${'h' + suffix}, now() + interval '1 day')`;
  await admin`INSERT INTO outbox (tenant_id, channel, to_address, body) VALUES (${B}, 'sms', '+919876543210', 'hi')`;
});

afterAll(async () => {
  await admin`DELETE FROM tenants WHERE id IN (${ids.A}, ${ids.B})`;
  await Promise.all([admin.end(), app.end()]);
});

const TABLES = ['question_banks', 'question_bank_versions', 'questions', 'question_audio', 'jobs', 'rubrics',
                'consent_texts', 'candidates', 'invitations', 'outbox'];

describe('tenant setup isolation', () => {
  it.each(TABLES)('%s: tenant A sees none of tenant B’s rows', async table => {
    const rows = await as(ids.A, tx => tx`SELECT 1 FROM ${tx(table)} WHERE tenant_id = ${ids.B}`);
    expect(rows).toHaveLength(0);
  });

  it.each(TABLES)('%s: tenant B sees its own rows', async table => {
    const rows = await as(ids.B, tx => tx`SELECT 1 FROM ${tx(table)} WHERE tenant_id = ${ids.B}`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('tenant A cannot add a candidate to tenant B’s job', async () => {
    await expect(as(ids.A, tx => tx`INSERT INTO candidates (tenant_id, job_id, name, phone) VALUES (${ids.B}, ${ids.job}, 'X', '+919000000000')`))
      .rejects.toThrow(/row-level security/);
  });

  it('tenant A cannot change tenant B’s job or revoke B’s invitations', async () => {
    expect(await as(ids.A, tx => tx`UPDATE jobs SET status = 'closed' WHERE id = ${ids.job} RETURNING id`)).toHaveLength(0);
    expect(await as(ids.A, tx => tx`UPDATE invitations SET status = 'revoked' WHERE candidate_id = ${ids.candidate} RETURNING id`)).toHaveLength(0);
  });

  it('saved question versions, rubrics and consent notices cannot be edited or deleted, even by their owner', async () => {
    for (const q of [
      (tx: postgres.TransactionSql) => tx`UPDATE questions SET good_answer = 'changed' WHERE id = ${ids.question}`,
      (tx: postgres.TransactionSql) => tx`DELETE FROM question_bank_versions WHERE id = ${ids.version}`,
      (tx: postgres.TransactionSql) => tx`UPDATE rubrics SET shortlist_cutoff = 10`,
      (tx: postgres.TransactionSql) => tx`UPDATE consent_texts SET texts = '{}'`,
    ]) await expect(as(ids.B, q)).rejects.toThrow(/permission denied/);
  });

  it('a tenant admin can’t get a password link for someone who also belongs to another tenant', async () => {
    const [{ id: u }] = await admin`INSERT INTO users (email, name) VALUES (${`shared-${suffix}@test.local`}, 'Shared') RETURNING id`;
    await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${ids.A}, ${u}, 'recruiter'), (${ids.B}, ${u}, 'recruiter')`;
    const [{ ok }] = await as(ids.A, tx => tx`SELECT user_is_exclusive_to_tenant(${u}, ${ids.A}) AS ok`);
    expect(ok).toBe(false);
    await admin`DELETE FROM users WHERE id = ${u}`;
  });
});

describe('composite tenant keys (database-level, even for the owner role that bypasses RLS)', () => {
  it('refuses a row that links to another tenant’s row', async () => {
    // A job in tenant A using tenant B's question bank.
    await expect(admin`INSERT INTO jobs (tenant_id, title, languages, bank_id) VALUES (${ids.A}, 'Cross', '{en}', ${ids.bank})`)
      .rejects.toThrow(/jobs_bank_id_fkey/);
    // A candidate in tenant A for tenant B's job.
    await expect(admin`INSERT INTO candidates (tenant_id, job_id, name, phone) VALUES (${ids.A}, ${ids.job}, 'X', '+919876543211')`)
      .rejects.toThrow(/candidates_job_id_fkey/);
    // Moving tenant B's candidate into tenant A while it still points at B's job.
    await expect(admin`UPDATE candidates SET tenant_id = ${ids.A} WHERE id = ${ids.candidate}`).rejects.toThrow(/fkey/);
  });

  it('still clears an optional link when its target is deleted', async () => {
    const [bank] = await admin`INSERT INTO question_banks (tenant_id, name) VALUES (${ids.B}, 'Temp') RETURNING id`;
    const [job] = await admin`INSERT INTO jobs (tenant_id, title, languages, bank_id) VALUES (${ids.B}, 'Temp job', '{en}', ${bank.id}) RETURNING id`;
    await admin`DELETE FROM question_banks WHERE id = ${bank.id}`;
    expect((await admin`SELECT tenant_id, bank_id FROM jobs WHERE id = ${job.id}`)[0]).toEqual({ tenant_id: ids.B, bank_id: null });
  });
});
