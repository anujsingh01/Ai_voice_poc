// Proves one tenant can never read or change another tenant's data, at the database level.
// Runs against the local database as the restricted app role, exactly as the app does.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const app = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

let A: string, B: string, userA: string, userB: string;
const suffix = Date.now().toString(36);

/** Runs `fn` as the app role with the given RLS context, inside a transaction that is rolled back. */
async function as<T>(ctx: { tenantId?: string; superAdmin?: boolean }, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  let result: T;
  await app.begin(async tx => {
    await tx`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
                    set_config('app.is_super_admin', ${ctx.superAdmin ? 'on' : 'off'}, true)`;
    result = await fn(tx);
    throw new Rollback();
  }).catch(e => { if (!(e instanceof Rollback)) throw e; });
  return result!;
}
class Rollback extends Error {}

beforeAll(async () => {
  [{ id: A }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Test A', ${'test-a-' + suffix}) RETURNING id`;
  [{ id: B }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Test B', ${'test-b-' + suffix}) RETURNING id`;
  await admin`INSERT INTO tenant_limits (tenant_id) VALUES (${A}), (${B})`;
  [{ id: userA }] = await admin`INSERT INTO users (email, name) VALUES (${`a-${suffix}@test.local`}, 'A') RETURNING id`;
  [{ id: userB }] = await admin`INSERT INTO users (email, name) VALUES (${`b-${suffix}@test.local`}, 'B') RETURNING id`;
  await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${A}, ${userA}, 'tenant_admin'), (${B}, ${userB}, 'tenant_admin')`;
  await admin`INSERT INTO audit_log (tenant_id, action) VALUES (${A}, 'test.a'), (${B}, 'test.b'), (NULL, 'test.platform')`;
});

afterAll(async () => {
  await admin`DELETE FROM audit_log WHERE action LIKE 'test.%'`;
  await admin`DELETE FROM tenants WHERE id IN (${A}, ${B})`;
  await admin`DELETE FROM users WHERE id IN (${userA}, ${userB})`;
  await Promise.all([admin.end(), app.end()]);
});

describe('tenant isolation (row-level security)', () => {
  it('the app role really is subject to RLS', async () => {
    const [r] = await app`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('with no tenant context, tenant tables return nothing', async () => {
    const counts = await as({}, async tx => ({
      tenants: (await tx`SELECT * FROM tenants WHERE id IN (${A}, ${B})`).length,
      limits: (await tx`SELECT * FROM tenant_limits WHERE tenant_id IN (${A}, ${B})`).length,
      members: (await tx`SELECT * FROM memberships WHERE tenant_id IN (${A}, ${B})`).length,
      audit: (await tx`SELECT * FROM audit_log WHERE action LIKE 'test.%'`).length,
    }));
    expect(counts).toEqual({ tenants: 0, limits: 0, members: 0, audit: 0 });
  });

  it('tenant A sees only its own rows', async () => {
    const seen = await as({ tenantId: A }, async tx => ({
      tenants: (await tx`SELECT id FROM tenants WHERE id IN (${A}, ${B})`).map(r => r.id),
      limits: (await tx`SELECT tenant_id FROM tenant_limits WHERE tenant_id IN (${A}, ${B})`).map(r => r.tenant_id),
      members: (await tx`SELECT tenant_id FROM memberships WHERE tenant_id IN (${A}, ${B})`).map(r => r.tenant_id),
      audit: (await tx`SELECT action FROM audit_log WHERE action LIKE 'test.%'`).map(r => r.action),
    }));
    expect(seen).toEqual({ tenants: [A], limits: [A], members: [A], audit: ['test.a'] });
  });

  it('tenant A cannot read B even when asking for B by id', async () => {
    const rows = await as({ tenantId: A }, tx => tx`SELECT * FROM tenant_limits WHERE tenant_id = ${B}`);
    expect(rows).toHaveLength(0);
  });

  it('tenant A cannot change B’s data', async () => {
    const updated = await as({ tenantId: A }, tx => tx`UPDATE memberships SET role = 'reviewer' WHERE tenant_id = ${B} RETURNING id`);
    expect(updated).toHaveLength(0);
    const deleted = await as({ tenantId: A }, tx => tx`DELETE FROM memberships WHERE tenant_id = ${B} RETURNING id`);
    expect(deleted).toHaveLength(0);
  });

  it('tenant A cannot insert rows into B', async () => {
    await expect(as({ tenantId: A }, tx => tx`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${B}, ${userA}, 'recruiter')`))
      .rejects.toThrow(/row-level security/);
    await expect(as({ tenantId: A }, tx => tx`INSERT INTO audit_log (tenant_id, action) VALUES (${B}, 'test.forged')`))
      .rejects.toThrow(/row-level security/);
  });

  it('tenants cannot change their own limits or status (only the super admin can)', async () => {
    await expect(as({ tenantId: A }, tx => tx`UPDATE tenant_limits SET interviews_per_month = 999999 WHERE tenant_id = ${A}`))
      .rejects.toThrow(/row-level security/);
    await expect(as({ tenantId: A }, tx => tx`UPDATE tenants SET status = 'active' WHERE id = ${A}`))
      .rejects.toThrow(/row-level security/);
  });

  it('the audit log cannot be edited or deleted by the app', async () => {
    await expect(as({ superAdmin: true }, tx => tx`UPDATE audit_log SET action = 'x' WHERE action = 'test.a'`)).rejects.toThrow(/permission denied/);
    await expect(as({ superAdmin: true }, tx => tx`DELETE FROM audit_log WHERE action = 'test.a'`)).rejects.toThrow(/permission denied/);
  });

  it('the super admin sees every tenant, including platform-level audit entries', async () => {
    const seen = await as({ superAdmin: true }, async tx => ({
      tenants: (await tx`SELECT id FROM tenants WHERE id IN (${A}, ${B})`).length,
      audit: (await tx`SELECT action FROM audit_log WHERE action LIKE 'test.%' ORDER BY action`).map(r => r.action),
    }));
    expect(seen).toEqual({ tenants: 2, audit: ['test.a', 'test.b', 'test.platform'] });
  });

  it('a forged context value cannot widen access', async () => {
    const rows = await as({ tenantId: `${A}' OR '1'='1` }, tx => tx`SELECT 1 FROM tenants`).catch(e => e);
    expect(rows).toBeInstanceOf(Error);   // not a valid uuid: the query fails instead of leaking
  });
});
