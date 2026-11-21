'use server';

import { randomBytes } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { withContext } from '@/db';
import { signWebhook } from '@/lib/billing/razorpay';
import { billingDriver, isLocal } from '@/lib/env';

// Local stand-in for Razorpay: builds the webhooks Razorpay would send and posts them, signed, to our
// real webhook endpoint. Only with BILLING_DRIVER=fake on this computer.
export type Simulation = 'pay' | 'start' | 'renew' | 'fail' | 'halt' | 'end';

const s = (d: Date) => Math.floor(d.getTime() / 1000);
const rid = (prefix: string) => `${prefix}_fake${randomBytes(6).toString('hex')}`;

async function send(event: string, payload: Record<string, { entity: Record<string, unknown> }>) {
  const body = JSON.stringify({ entity: 'event', event, payload, created_at: s(new Date()) });
  const res = await fetch(`${process.env.APP_URL}/api/billing/razorpay/webhook`, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signWebhook(body), 'X-Razorpay-Event-Id': rid('evt') },
  });
  if (!res.ok) throw new Error(`webhook ${event} answered ${res.status}`);
}

export async function simulate(rzSubId: string, kind: Simulation) {
  if (!isLocal() || billingDriver() !== 'fake') notFound();
  const [sub] = await withContext({ superAdmin: true }, tx => tx`SELECT s.*, t.slug FROM billing_subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE razorpay_subscription_id = ${rzSubId}`);
  if (!sub) notFound();
  const add = (d: Date) => { const n = new Date(d); if (sub.billing_period === 'monthly') n.setMonth(n.getMonth() + 1); else n.setFullYear(n.getFullYear() + 1); return n; };
  const entity = (status: string, start: Date | null, end: Date | null) => ({
    subscription: { entity: { id: rzSubId, entity: 'subscription', status, current_start: start && s(start), current_end: end && s(end), notes: {} } },
  });
  const charge = async (start: Date, status: string, event: string) => {
    const end = add(start), pay = rid('pay'), inv = rid('inv');
    await send(event, { ...entity(status, start, end), payment: { entity: { id: pay, amount: sub.price_inr * 100, status: 'captured', method: 'upi', invoice_id: inv } } });
    await send('invoice.paid', { invoice: { entity: { id: inv, subscription_id: rzSubId, payment_id: pay, amount_paid: sub.price_inr * 100, short_url: `${process.env.APP_URL}/dev/razorpay/${rzSubId}?invoice=${inv}`, billing_start: s(start), billing_end: s(end) } } });
  };
  const now = new Date();
  const currentEnd = sub.current_end ? new Date(sub.current_end) : now;

  if (kind === 'pay') {
    await send('subscription.authenticated', entity('authenticated', null, null));
    if (!sub.starts_at || new Date(sub.starts_at) <= now) {
      await send('subscription.activated', entity('active', now, add(now)));
      await charge(now, 'active', 'subscription.charged');
    }
  }
  if (kind === 'start') {                // a scheduled subscription's start date arrives
    const start = sub.starts_at ? new Date(sub.starts_at) : now;
    await send('subscription.activated', entity('active', start, add(start)));
    await charge(start, 'active', 'subscription.charged');
  }
  if (kind === 'renew') await charge(currentEnd, 'active', 'subscription.charged');
  if (kind === 'fail') {
    await send('subscription.pending', { ...entity('pending', sub.current_start, currentEnd),
      payment: { entity: { id: rid('pay'), amount: sub.price_inr * 100, status: 'failed', method: 'card', error_description: 'Your card was declined by the bank.' } } });
  }
  if (kind === 'halt') await send('subscription.halted', entity('halted', sub.current_start, currentEnd));
  if (kind === 'end') await send('subscription.cancelled', entity('cancelled', sub.current_start, currentEnd));
  redirect(kind === 'pay' ? `/t/${sub.slug}/billing?msg=paid` : `/dev/razorpay/${rzSubId}?done=${kind}`);
}
