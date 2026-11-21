import { Check, CreditCard, Receipt } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Button, Card, EmptyState, Field, Notice, PageHeader, Section, Textarea, messageFor } from '@/components/ui';
import { withContext } from '@/db';
import { billingDriver } from '@/lib/env';
import { languageName } from '@/lib/languages';
import { formatPrice, type Plan } from '@/lib/plans';
import { inTenant, requireTenant } from '@/lib/tenant';
import { cancelPlan, choosePlan, saveBillingDetails } from './actions';

const MESSAGES = {
  details_saved: 'Billing details saved.',
  paid: 'Thank you! Your payment is being confirmed; this page updates within a minute.',
  cancelled: 'Renewal cancelled. You keep your plan until the end of the period you’ve paid for.',
};
const ERRORS = {
  details_invalid: 'Check the billing details: name, a valid email, an Indian mobile number and a 15-character GSTIN (or leave it empty).',
  details: 'Fill in your billing details first; they go on your invoices.',
  plan: 'That plan can’t be chosen online. Ask the platform administrator.',
  same_plan: 'You’re already subscribed to that plan.',
  suspended: 'This account was paused by the platform administrator. Please contact them.',
  none: 'There’s no subscription to cancel.',
};

const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
const inr = (n: number | string) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default async function BillingPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  if (ctx.role && ctx.role !== 'tenant_admin') redirect(`/t/${slug}`);
  const admin = ctx.role === 'tenant_admin';
  const { msg, error } = await searchParams;
  const online = !!billingDriver();

  const { tenant, plans } = await withContext({ superAdmin: true }, async tx => {
    const [tenant] = await tx`SELECT t.*, p.name AS plan_name, p.price_inr, p.billing_period FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = ${ctx.tenant.id}`;
    const plans = (await tx`SELECT * FROM plans WHERE self_serve AND NOT archived AND price_inr > 0 ORDER BY sort_order, price_inr`) as unknown as Plan[];
    return { tenant, plans };
  });
  const { subs, payments } = await inTenant(ctx, async tx => ({
    subs: await tx`SELECT s.*, p.name AS plan_name FROM billing_subscriptions s JOIN plans p ON p.id = s.plan_id
                   WHERE s.status IN ('authenticated', 'active', 'pending', 'halted') ORDER BY s.created_at`,
    payments: await tx`SELECT * FROM billing_payments ORDER BY created_at DESC LIMIT 36`,
  }));
  const current = subs.find(s => ['active', 'pending', 'halted'].includes(s.status));
  const scheduled = subs.find(s => s.status === 'authenticated' && !s.cancel_at_period_end);
  const renewing = subs.some(s => !s.cancel_at_period_end && s.status !== 'halted');
  const hasDetails = !!(tenant.billing_name && tenant.billing_email);
  const takenPlanIds = new Set(subs.filter(s => !s.cancel_at_period_end && s.status !== 'halted').map(s => s.plan_id));

  return (
    <>
      <PageHeader title="Plan & billing" description="Your plan, payments and invoices. Prices include GST." />
      {messageFor(msg, MESSAGES) && <Notice kind="success">{messageFor(msg, MESSAGES)}</Notice>}
      {messageFor(error, ERRORS) && <Notice>{messageFor(error, ERRORS)}</Notice>}

      <Section title="Your plan">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-lg font-semibold text-slate-900">{tenant.plan_name ?? 'No plan yet'}</span>
          {tenant.plan_name && tenant.price_inr != null && <span className="text-brand-700">{formatPrice(tenant as unknown as Plan)}</span>}
        </div>
        <div className="mt-3 space-y-1.5 text-sm text-slate-600">
          {tenant.status === 'trial' && tenant.trial_ends_at && (
            <p>Free trial until <b>{fmt(tenant.trial_ends_at)}</b>.{!scheduled && !current && ' Choose a plan below to keep going after that; you won’t be charged before the trial ends.'}</p>
          )}
          {tenant.status === 'suspended' && tenant.suspended_for_billing && <Notice kind="warning">Your account is paused because the subscription isn’t paid. Choose a plan below to pay and reopen it straight away.</Notice>}
          {current?.status === 'active' && (current.cancel_at_period_end
            ? <p>Renewal cancelled: your plan stays active until <b>{fmt(current.current_end)}</b>.</p>
            : <p>Renews automatically on <b>{fmt(current.current_end)}</b> for {inr(current.price_inr)}.</p>)}
          {current?.status === 'pending' && (
            <Notice kind="warning">
              The last payment didn’t go through. Razorpay will try again over the next few days.{' '}
              {current.checkout_url && admin && <a href={current.checkout_url} className="font-semibold underline">Update payment method</a>}
            </Notice>
          )}
          {scheduled && (current
            ? <p>Changing to <b>{scheduled.plan_name}</b> on <b>{fmt(scheduled.starts_at)}</b> ({inr(scheduled.price_inr)} from then).</p>
            : <p>Payment set up: <b>{scheduled.plan_name}</b> starts on <b>{fmt(scheduled.starts_at)}</b>, with the first charge of {inr(scheduled.price_inr)} that day.</p>)}
          {tenant.billing_mode === 'manual' && !current && !scheduled && tenant.status !== 'trial' && (
            <p>Your plan is arranged with the platform administrator{online ? '. You can also switch to paying online below.' : '.'}</p>
          )}
        </div>
      </Section>

      {online && (
        <Section title="Plans" description={hasDetails ? 'Pay by card, UPI AutoPay or netbanking on Razorpay’s secure page. Renews automatically; cancel any time.' : 'Fill in your billing details first.'}>
          {plans.length === 0 ? <p className="text-sm text-slate-500">No plans are offered online yet. Ask the platform administrator.</p> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map(p => {
                const taken = takenPlanIds.has(p.id);
                return (
                  <div key={p.id} className={`flex flex-col rounded-2xl border p-5 ${taken ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200'}`}>
                    <h3 className="font-semibold text-slate-900">{p.name}</h3>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{formatPrice(p)}</p>
                    {p.description && <p className="mt-1 text-sm text-slate-500">{p.description}</p>}
                    <ul className="mt-4 flex-1 space-y-1.5 text-sm text-slate-700">
                      {[`${p.interviews_per_month.toLocaleString('en-IN')} interviews a month`, `${p.recruiter_seats} recruiter seats`, `${p.concurrent_jobs} active jobs`,
                        p.languages.map(languageName).join(', '), `Recordings kept ${p.retention_days} days`].map(f => (
                        <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{f}</li>
                      ))}
                    </ul>
                    {admin && (taken
                      ? <p className="mt-5 text-center text-sm font-medium text-brand-700">Your plan</p>
                      : <form action={choosePlan.bind(null, slug, p.id)} className="mt-5">
                          <Button className="w-full" disabled={!hasDetails}><CreditCard className="size-4" /> {current?.status === 'active' ? 'Switch to this plan' : 'Choose and pay'}</Button>
                        </form>)}
                  </div>
                );
              })}
            </div>
          )}
          {current?.status === 'active' && !current.cancel_at_period_end && <p className="mt-4 text-xs text-slate-500">Switching plans takes effect when your current paid period ends, so nothing is charged twice.</p>}
        </Section>
      )}

      <div id="details">
        <Section title="Billing details" description="Shown on your invoices. Add your GSTIN to claim input tax credit.">
          <form action={saveBillingDetails.bind(null, slug)}>
            <fieldset disabled={!admin} className="grid gap-x-4 sm:grid-cols-2">
              <Field label="Company name (as registered)" name="billing_name" defaultValue={tenant.billing_name ?? ''} required maxLength={120} />
              <Field label="Billing email" name="billing_email" type="email" defaultValue={tenant.billing_email ?? ''} required hint="Receipts and payment reminders go here." />
              <Field label="Mobile (optional)" name="billing_phone" type="tel" defaultValue={tenant.billing_phone ?? ''} />
              <Field label="GSTIN (optional)" name="gstin" defaultValue={tenant.gstin ?? ''} maxLength={15} placeholder="29ABCDE1234F1Z5" />
              <div className="sm:col-span-2"><Textarea label="Billing address (optional)" name="billing_address" rows={2} maxLength={500} defaultValue={tenant.billing_address ?? ''} /></div>
            </fieldset>
            {admin && <Button variant={hasDetails ? 'secondary' : 'primary'}>Save billing details</Button>}
          </form>
        </Section>
      </div>

      <Section title="Payments" padded={false}>
        {payments.length === 0 ? <EmptyState icon={<Receipt className="size-5" />}>No payments yet.</EmptyState> : (
          <Card className="rounded-none border-0 shadow-none">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="px-6 py-2 font-medium">Date</th><th className="px-2 py-2 font-medium">Period</th><th className="px-2 py-2 font-medium">Amount</th><th className="px-2 py-2 font-medium">Status</th><th className="px-6 py-2 text-right font-medium">Invoice</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map(p => (
                  <tr key={p.id}>
                    <td className="px-6 py-3 text-slate-700">{fmt(p.created_at)}</td>
                    <td className="px-2 py-3 text-slate-500">{p.period_start ? `${fmt(p.period_start)} – ${fmt(p.period_end)}` : '—'}</td>
                    <td className="px-2 py-3 tabular-nums text-slate-900">{inr(p.amount_inr)}{p.method && <span className="ml-1.5 text-xs uppercase text-slate-400">{p.method}</span>}</td>
                    <td className="px-2 py-3">{p.status === 'captured' ? <span className="text-emerald-700">Paid</span> : <span className="text-rose-700" title={p.error ?? ''}>Failed{p.error ? `: ${p.error}` : ''}</span>}</td>
                    <td className="px-6 py-3 text-right">{p.invoice_url ? <a href={p.invoice_url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:text-brand-700">View</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>

      {admin && renewing && (
        <Section title="Cancel subscription">
          <form action={cancelPlan.bind(null, slug)} className="flex flex-wrap items-center gap-4">
            <p className="flex-1 text-sm text-slate-600">Stops automatic renewal. You keep everything until the end of the period you’ve paid for; after that the account is paused (data stays visible).</p>
            <Button variant="danger">Cancel renewal</Button>
          </form>
        </Section>
      )}
    </>
  );
}
