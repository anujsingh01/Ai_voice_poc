import type { Tx } from '@/db';

export type Plan = {
  id: string; name: string; description: string | null; price_inr: number; billing_period: 'monthly' | 'yearly';
  trial_days: number; interviews_per_month: number; concurrent_jobs: number; recruiter_seats: number; languages: string[];
  ai_budget_inr: number; scoring_mode: 'fast' | 'batch'; retention_days: number; own_openai_key: boolean;
  sort_order: number; archived: boolean; self_serve: boolean;
};

export const LIMIT_KEYS = ['interviews_per_month', 'concurrent_jobs', 'recruiter_seats', 'languages', 'ai_budget_inr',
  'scoring_mode', 'retention_days', 'own_openai_key'] as const;

/**
 * Moves a tenant onto a plan: its limits become the plan's (dropping any custom overrides), the previous
 * subscription is closed and a new one recorded. Caller runs this in the platform (super admin) context.
 */
export async function applyPlan(tx: Tx, tenantId: string, planId: string, userId: string | null) {
  const [p] = (await tx`SELECT * FROM plans WHERE id = ${planId}`) as unknown as Plan[];
  if (!p) throw new Error('Plan not found');
  await tx`
    INSERT INTO tenant_limits (tenant_id, interviews_per_month, concurrent_jobs, recruiter_seats, languages, ai_budget_inr,
                               scoring_mode, retention_days, own_openai_key, custom)
    VALUES (${tenantId}, ${p.interviews_per_month}, ${p.concurrent_jobs}, ${p.recruiter_seats}, ${p.languages}, ${p.ai_budget_inr},
            ${p.scoring_mode}, ${p.retention_days}, ${p.own_openai_key}, false)
    ON CONFLICT (tenant_id) DO UPDATE SET interviews_per_month = EXCLUDED.interviews_per_month, concurrent_jobs = EXCLUDED.concurrent_jobs,
      recruiter_seats = EXCLUDED.recruiter_seats, languages = EXCLUDED.languages, ai_budget_inr = EXCLUDED.ai_budget_inr,
      scoring_mode = EXCLUDED.scoring_mode, retention_days = EXCLUDED.retention_days, own_openai_key = EXCLUDED.own_openai_key,
      custom = false, updated_at = now()`;
  const [current] = await tx`SELECT plan_id FROM tenants WHERE id = ${tenantId}`;
  if (current.plan_id !== planId) {
    await tx`UPDATE tenant_subscriptions SET ended_at = now() WHERE tenant_id = ${tenantId} AND ended_at IS NULL`;
    await tx`INSERT INTO tenant_subscriptions (tenant_id, plan_id, price_inr, billing_period, changed_by)
             VALUES (${tenantId}, ${planId}, ${p.price_inr}, ${p.billing_period}, ${userId})`;
    await tx`UPDATE tenants SET plan_id = ${planId}, updated_at = now() WHERE id = ${tenantId}`;
  }
  return p;
}

export const formatPrice = (p: Pick<Plan, 'price_inr' | 'billing_period'>) =>
  p.price_inr === 0 ? 'Free' : `₹${p.price_inr.toLocaleString('en-IN')} / ${p.billing_period === 'monthly' ? 'month' : 'year'}`;
