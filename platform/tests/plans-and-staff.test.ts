import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withContext } from '@/db';
import { applyPlan } from '@/lib/plans';
import { platformCan, type PlatformRole } from '@/lib/platform';

const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const suffix = Date.now().toString(36);
let planA: string, planB: string, t1: string, t2: string;

beforeAll(async () => {
  const plan = (name: string, interviews: number) => admin`
    INSERT INTO plans (name, price_inr, interviews_per_month, concurrent_jobs, recruiter_seats, languages, ai_budget_inr, retention_days)
    VALUES (${name + ' ' + suffix}, 1000, ${interviews}, 3, 4, '{hi,en}', 700, 90) RETURNING id`;
  [{ id: planA }] = await plan('PlanA', 100);
  [{ id: planB }] = await plan('PlanB', 900);
  [{ id: t1 }] = await admin`INSERT INTO tenants (name, slug) VALUES ('P1', ${'p1-' + suffix}) RETURNING id`;
  [{ id: t2 }] = await admin`INSERT INTO tenants (name, slug) VALUES ('P2', ${'p2-' + suffix}) RETURNING id`;
});

afterAll(async () => {
  await admin`DELETE FROM tenants WHERE id IN (${t1}, ${t2})`;
  await admin`DELETE FROM plans WHERE id IN (${planA}, ${planB})`;
  await Promise.all([admin.end(), sql.end()]);
});

describe('platform staff permissions', () => {
  const can = (role: PlatformRole) => (p: Parameters<typeof platformCan>[1]) => platformCan({ is_super_admin: true, platform_role: role }, p);
  it('owner can do everything; only the owner manages staff', () => {
    for (const p of ['view', 'manageTenants', 'managePlans', 'assignPlans', 'manageWorkers', 'manageStaff'] as const) expect(can('owner')(p)).toBe(true);
    expect(can('admin')('manageStaff')).toBe(false);
  });
  it('billing designs and assigns plans but cannot touch tenants’ limits, members or PCs', () => {
    expect(can('billing')('managePlans')).toBe(true);
    expect(can('billing')('assignPlans')).toBe(true);
    expect(can('billing')('manageTenants')).toBe(false);
    expect(can('billing')('manageWorkers')).toBe(false);
  });
  it('support is read-only', () => {
    expect(can('support')('view')).toBe(true);
    for (const p of ['manageTenants', 'managePlans', 'assignPlans', 'manageWorkers', 'manageStaff'] as const) expect(can('support')(p)).toBe(false);
  });
  it('a tenant user is never platform staff, whatever the role column says', () => {
    expect(platformCan({ is_super_admin: false, platform_role: 'owner' }, 'view')).toBe(false);
  });
  it('the database refuses staff without a role, or a role without staff access', async () => {
    await expect(admin`INSERT INTO users (email, name, is_super_admin) VALUES (${'x-' + suffix + '@t.local'}, 'X', true)`).rejects.toThrow(/platform_role_matches/);
    await expect(admin`INSERT INTO users (email, name, platform_role) VALUES (${'y-' + suffix + '@t.local'}, 'Y', 'admin')`).rejects.toThrow(/platform_role_matches/);
  });
});

describe('subscription plans', () => {
  it('applying a plan copies its limits, records the subscription, and clears custom overrides', async () => {
    await withContext({ superAdmin: true }, tx => applyPlan(tx, t1, planA, null));
    const [l] = await admin`SELECT interviews_per_month, recruiter_seats, custom FROM tenant_limits WHERE tenant_id = ${t1}`;
    expect(l).toEqual({ interviews_per_month: 100, recruiter_seats: 4, custom: false });
    await admin`UPDATE tenant_limits SET interviews_per_month = 150, custom = true WHERE tenant_id = ${t1}`;
    await withContext({ superAdmin: true }, tx => applyPlan(tx, t1, planB, null));
    const [l2] = await admin`SELECT interviews_per_month, custom FROM tenant_limits WHERE tenant_id = ${t1}`;
    expect(l2).toEqual({ interviews_per_month: 900, custom: false });
    const subs = await admin`SELECT plan_id, ended_at IS NOT NULL AS ended FROM tenant_subscriptions WHERE tenant_id = ${t1} ORDER BY id`;
    expect(subs).toEqual([{ plan_id: planA, ended: true }, { plan_id: planB, ended: false }]);
  });

  it('re-applying the same plan refreshes limits without a new subscription row', async () => {
    await withContext({ superAdmin: true }, tx => applyPlan(tx, t1, planB, null));
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM tenant_subscriptions WHERE tenant_id = ${t1}`;
    expect(n).toBe(2);
  });

  it('a tenant can read only its own plan, and can’t change any plan or its subscription', async () => {
    await withContext({ superAdmin: true }, tx => applyPlan(tx, t2, planA, null));
    const seen = await withContext({ tenantId: t2 }, tx => tx`SELECT id FROM plans WHERE id IN (${planA}, ${planB})`);
    expect(seen.map(r => r.id)).toEqual([planA]);
    const changed = await withContext({ tenantId: t2 }, tx => tx`UPDATE plans SET price_inr = 0 WHERE id = ${planA} RETURNING id`);
    expect(changed).toHaveLength(0);
    await expect(withContext({ tenantId: t2 }, tx => tx`INSERT INTO tenant_subscriptions (tenant_id, plan_id, price_inr, billing_period) VALUES (${t2}, ${planB}, 0, 'monthly')`))
      .rejects.toThrow(/row-level security/);
  });
});
