import { notFound } from 'next/navigation';
import { withContext } from '@/db';
import { Button, Notice } from '@/components/ui';
import { billingDriver, isLocal } from '@/lib/env';
import { simulate, type Simulation } from '../actions';

export const dynamic = 'force-dynamic';

const STEPS: [Simulation, string, string][] = [
  ['start', 'Start date arrives', 'For a plan change or a trial: the first charge on the scheduled date.'],
  ['renew', 'Renew (next charge succeeds)', 'Moves on one billing period.'],
  ['fail', 'Next charge fails', 'Razorpay will retry; the HR admins get an email.'],
  ['halt', 'All retries fail', 'The account is paused until paid.'],
  ['end', 'Period ends after cancelling', 'The subscription ends; the account is paused.'],
];

// Local stand-in for Razorpay's payment page (BILLING_DRIVER=fake). Never available on AWS.
export default async function FakeCheckout({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; invoice?: string }> }) {
  if (!isLocal() || billingDriver() !== 'fake') notFound();
  const { id } = await params;
  const { done, invoice } = await searchParams;
  const [sub] = await withContext({ superAdmin: true }, tx => tx`SELECT s.*, p.name AS plan_name, t.name AS tenant_name, t.slug FROM billing_subscriptions s
                          JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id WHERE razorpay_subscription_id = ${id}`);
  if (!sub) notFound();
  const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Test checkout · not Razorpay · no money moves</p>
      {invoice ? (
        <>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">Invoice {invoice}</h1>
          <p className="mt-2 text-sm text-slate-600">{sub.tenant_name} · {sub.plan_name} · ₹{sub.price_inr.toLocaleString('en-IN')}. On Razorpay this link opens the real GST invoice.</p>
        </>
      ) : (
        <>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">{sub.plan_name} for {sub.tenant_name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            ₹{sub.price_inr.toLocaleString('en-IN')} / {sub.billing_period === 'monthly' ? 'month' : 'year'} ·
            status <b>{sub.status}</b>{sub.starts_at ? ` · first charge ${fmt(sub.starts_at)}` : ''}{sub.current_end ? ` · paid until ${fmt(sub.current_end)}` : ''}
          </p>
          {done && <div className="mt-4"><Notice kind="success">Sent “{STEPS.find(s => s[0] === done)?.[1] ?? done}” to the platform.</Notice></div>}
          {sub.status === 'created' ? (
            <form action={simulate.bind(null, id, 'pay')} className="mt-6">
              <p className="mb-3 text-sm text-slate-600">On Razorpay the admin would now approve a card, UPI AutoPay or bank mandate.</p>
              <Button className="w-full">Approve and pay</Button>
            </form>
          ) : (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-slate-600">Later events Razorpay would send:</p>
              {STEPS.map(([kind, label, hint]) => (
                <form key={kind} action={simulate.bind(null, id, kind)} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-3">
                  <span className="text-sm"><b className="text-slate-900">{label}</b><span className="block text-xs text-slate-500">{hint}</span></span>
                  <Button variant="secondary" size="sm">Send</Button>
                </form>
              ))}
            </div>
          )}
        </>
      )}
      <p className="mt-8 text-sm"><a className="font-medium text-brand-600" href={`/t/${sub.slug}/billing`}>Back to the Billing page</a></p>
    </main>
  );
}
