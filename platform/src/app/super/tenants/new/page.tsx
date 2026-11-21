import { Button, Field, Notice, PageHeader, Section, Select, messageFor } from '@/components/ui';
import { withContext } from '@/db';
import { formatPrice, type Plan } from '@/lib/plans';
import { requirePlatform } from '@/lib/platform';
import { createTenant } from '../../actions';

const ERRORS = {
  slug: 'The web address must be 3–50 lowercase letters, numbers or dashes.',
  slug_taken: 'That web address is already used by another tenant.',
  staff_account: 'That admin email belongs to a platform staff account. Use the company’s own email.',
  invalid: 'Some fields are missing or not valid. Check the company name, the plan, and the admin’s name and email.',
};

export default async function NewTenantPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePlatform('manageTenants');
  const plans = (await withContext({ superAdmin: true }, tx => tx`SELECT * FROM plans WHERE NOT archived ORDER BY sort_order, price_inr`)) as unknown as Plan[];
  const err = messageFor((await searchParams).error, ERRORS);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New company" back={{ href: '/super', label: 'Companies' }} />
      {err && <Notice>{err}</Notice>}
      <form action={createTenant}>
        <Section title="Company">
          <Field label="Company name" name="name" required placeholder="Prestige – South Region" />
          <Field label="Web address" name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]" placeholder="prestige-south"
                 hint="Lowercase letters, numbers and dashes. Used in links, e.g. /t/prestige-south." />
          <Select label="Start as" name="status" defaultValue="trial">
            <option value="trial">Free trial (length set by the plan)</option>
            <option value="active">Active (paying)</option>
          </Select>
        </Section>
        <Section title="Plan" description="The company gets the plan’s limits. You can still adjust limits for this one company afterwards.">
          <div className="grid sm:grid-cols-3 gap-3">
            {plans.map((p, i) => (
              <label key={p.id} className="block border border-slate-200 rounded-xl p-4 cursor-pointer has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                <input type="radio" name="plan_id" value={p.id} defaultChecked={i === 0} required className="sr-only" />
                <span className="block font-semibold text-slate-900">{p.name}</span>
                <span className="block text-brand-700 font-medium">{formatPrice(p)}</span>
                <span className="block text-xs text-slate-600 mt-2">
                  {p.interviews_per_month.toLocaleString('en-IN')} interviews/month · {p.recruiter_seats} seats · {p.languages.length} languages
                  {p.trial_days > 0 && ` · ${p.trial_days}-day trial`}
                </span>
              </label>
            ))}
          </div>
        </Section>
        <Section title="First HR admin" description="After saving, you’ll get a one-time link to send them so they can set a password.">
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Name" name="admin_name" required />
            <Field label="Email" name="admin_email" type="email" required />
          </div>
        </Section>
        <Button>Create company</Button>
      </form>
    </div>
  );
}
