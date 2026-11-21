import { Checkbox, Field, Select, Textarea } from '@/components/ui';
import type { Plan } from '@/lib/plans';
import { LimitsFields } from '../limits-fields';

export const NEW_PLAN: Omit<Plan, 'id' | 'archived'> = {
  name: '', description: '', price_inr: 0, billing_period: 'monthly', trial_days: 14, sort_order: 10,
  interviews_per_month: 1000, concurrent_jobs: 5, recruiter_seats: 5, languages: ['hi', 'en'], ai_budget_inr: 2000,
  scoring_mode: 'fast', retention_days: 180, own_openai_key: false, self_serve: false,
};

export function PlanFields({ plan, disabled }: { plan: Omit<Plan, 'id' | 'archived'>; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Plan name" name="name" defaultValue={plan.name} required maxLength={60} placeholder="Growth" />
        <Field label="Display order" name="sort_order" type="number" min={0} defaultValue={plan.sort_order} hint="Lower numbers are listed first." />
      </div>
      <Textarea label="Description" name="description" rows={2} maxLength={300} defaultValue={plan.description ?? ''} />
      <div className="grid sm:grid-cols-3 gap-x-4">
        <Field label="Price (₹)" name="price_inr" type="number" min={0} defaultValue={plan.price_inr} required hint="0 = free" />
        <Select label="Billed" name="billing_period" defaultValue={plan.billing_period}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </Select>
        <Field label="Free trial (days)" name="trial_days" type="number" min={0} max={90} defaultValue={plan.trial_days} required />
      </div>
      <Checkbox name="self_serve" defaultChecked={plan.self_serve}
                label="HR admins can choose and pay for this plan online (Billing page, via Razorpay)"
                hint="The price includes GST. Changing the price later applies to new subscriptions; existing ones keep their price." />
      <div className="mb-4" />
      <h3 className="font-medium text-slate-900 mt-2 mb-3">What the plan includes</h3>
      <LimitsFields limits={plan} />
    </fieldset>
  );
}
