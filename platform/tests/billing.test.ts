// Online billing: subscribing, what each Razorpay webhook does to the tenant, plan changes, and safety rules.
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@/db';
import { BillingError, cancelSubscription, handleRazorpayEvent, startSubscription, type RazorpayEvent } from '@/lib/billing/billing';
import { signWebhook, verifyWebhook } from '@/lib/billing/razorpay';
import { billingProblems } from '@/lib/env';

const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const suffix = Date.now().toString(36);
const savedDriver = process.env.BILLING_DRIVER;
let T: string, user: string, basic: string, pro: string, hidden: string;
let n = 0;
const eventId = () => `evt_test_${suffix}_${++n}`;
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const DAY = 86400e3;

function ev(event: string, sub: string, status: string, extra: Partial<RazorpayEvent['payload']> = {}, period?: [Date, Date]): RazorpayEvent {
  return { event, payload: { subscription: { entity: { id: sub, status, current_start: period && unix(period[0]), current_end: period && unix(period[1]) } }, ...extra } };
}
const payment = (id: string, rupees: number, status = 'captured') => ({ payment: { entity: { id, amount: rupees * 100, status, method: 'upi', error_description: status === 'failed' ? 'Declined' : null } } });
const tenant = async () => (await admin`SELECT status, plan_id, suspended_for_billing, billing_mode, trial_ends_at FROM tenants WHERE id = ${T}`)[0];
const subRow = async (id: string) => (await admin`SELECT * FROM billing_subscriptions WHERE razorpay_subscription_id = ${id}`)[0];

beforeAll(async () => {
  process.env.BILLING_DRIVER = 'fake';
  [{ id: user }] = await admin`INSERT INTO users (email, name) VALUES (${`bill-${suffix}@example.test`}, 'Bill Admin') RETURNING id`;
  const plan = (name: string, price: number, selfServe = true) => admin`
    INSERT INTO plans (name, price_inr, billing_period, interviews_per_month, concurrent_jobs, recruiter_seats, languages, ai_budget_inr, retention_days, self_serve)
    VALUES (${name + ' ' + suffix}, ${price}, 'monthly', ${Math.floor(price / 10)}, 3, 3, '{hi,en}', 1000, 90, ${selfServe}) RETURNING id`;
  [{ id: basic }] = await plan('Basic', 4999);
  [{ id: pro }] = await plan('Pro', 9999);
  [{ id: hidden }] = await plan('Enterprise', 99999, false);
});

beforeEach(async () => {
  if (T) await admin`DELETE FROM tenants WHERE id = ${T}`;
  [{ id: T }] = await admin`INSERT INTO tenants (name, slug, status, trial_ends_at) VALUES ('Billing Co', ${'bill-' + suffix + n}, 'active', NULL) RETURNING id`;
  await admin`INSERT INTO tenant_limits (tenant_id) VALUES (${T})`;
  await admin`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${T}, ${user}, 'tenant_admin')`;
  await admin`UPDATE tenants SET billing_name = 'Billing Co Pvt Ltd', billing_email = 'accounts@billing.test' WHERE id = ${T}`;
});

afterAll(async () => {
  if (savedDriver === undefined) delete process.env.BILLING_DRIVER; else process.env.BILLING_DRIVER = savedDriver;
  if (T) await admin`DELETE FROM tenants WHERE id = ${T}`;
  if (basic) await admin`DELETE FROM plans WHERE id IN (${basic}, ${pro}, ${hidden})`;
  if (user) await admin`DELETE FROM users WHERE id = ${user}`;
  await admin`DELETE FROM billing_webhook_events WHERE event_id LIKE ${`evt_test_${suffix}_%`}`;
  await Promise.all([admin.end(), sql.end()]);
});

const subscribe = async (planId: string) => {
  const url = await startSubscription(T, planId, user, null);
  const id = url.split('/').pop()!;
  return id;
};

describe('subscribing', () => {
  it('needs billing details and a plan that is offered online', async () => {
    await expect(startSubscription(T, hidden, user, null)).rejects.toThrow(BillingError);
    await admin`UPDATE tenants SET billing_name = NULL WHERE id = ${T}`;
    await expect(startSubscription(T, basic, user, null)).rejects.toMatchObject({ code: 'details' });
  });

  it('pays now, activates the tenant on the plan and records the payment once', async () => {
    const sub = await subscribe(basic);
    expect((await subRow(sub))).toMatchObject({ status: 'created', price_inr: 4999, starts_at: null });
    const now = new Date(), end = new Date(Date.now() + 30 * DAY);
    expect(await handleRazorpayEvent(eventId(), ev('subscription.authenticated', sub, 'authenticated'))).toBe('done');
    const charged = eventId();
    expect(await handleRazorpayEvent(charged, ev('subscription.charged', sub, 'active', payment(`pay_${suffix}a`, 4999), [now, end]))).toBe('done');
    expect(await handleRazorpayEvent(charged, ev('subscription.charged', sub, 'active', payment(`pay_${suffix}a`, 4999), [now, end]))).toBe('duplicate');
    expect(await tenant()).toMatchObject({ status: 'active', plan_id: basic, billing_mode: 'razorpay', suspended_for_billing: false });
    expect((await admin`SELECT interviews_per_month FROM tenant_limits WHERE tenant_id = ${T}`)[0].interviews_per_month).toBe(499);
    // Paying again for the same plan re-applies its limits, unless staff customised them.
    await admin`UPDATE tenant_limits SET interviews_per_month = 7 WHERE tenant_id = ${T}`;
    await handleRazorpayEvent(eventId(), ev('subscription.charged', sub, 'active', payment(`pay_${suffix}a2`, 4999)));
    expect((await admin`SELECT interviews_per_month FROM tenant_limits WHERE tenant_id = ${T}`)[0].interviews_per_month).toBe(499);
    await admin`UPDATE tenant_limits SET interviews_per_month = 7, custom = true WHERE tenant_id = ${T}`;
    await handleRazorpayEvent(eventId(), ev('subscription.charged', sub, 'active', payment(`pay_${suffix}a3`, 4999)));
    expect((await admin`SELECT interviews_per_month FROM tenant_limits WHERE tenant_id = ${T}`)[0].interviews_per_month).toBe(7);
    const pays = await admin`SELECT amount_inr, status FROM billing_payments WHERE tenant_id = ${T} AND razorpay_payment_id = ${`pay_${suffix}a`}`;
    expect(pays).toEqual([{ amount_inr: '4999.00', status: 'captured' }]);
    await handleRazorpayEvent(eventId(), { event: 'invoice.paid', payload: { invoice: { entity: { id: `inv_${suffix}`, subscription_id: sub, payment_id: `pay_${suffix}a`, amount_paid: 499900, short_url: 'https://rzp.io/i/x' } } } });
    expect((await admin`SELECT invoice_url FROM billing_payments WHERE razorpay_payment_id = ${`pay_${suffix}a`}`)[0].invoice_url).toBe('https://rzp.io/i/x');
  });

  it('during a trial, the first charge is when the trial ends', async () => {
    const trialEnd = new Date(Date.now() + 10 * DAY);
    await admin`UPDATE tenants SET status = 'trial', trial_ends_at = ${trialEnd} WHERE id = ${T}`;
    const sub = await subscribe(basic);
    expect(new Date((await subRow(sub)).starts_at).getTime()).toBe(trialEnd.getTime());
    await handleRazorpayEvent(eventId(), ev('subscription.authenticated', sub, 'authenticated'));
    expect((await tenant()).status).toBe('trial');                             // still a trial until the first charge
  });
});

describe('failed payments', () => {
  it('warns on a failed charge, suspends when Razorpay gives up, and reopens on payment', async () => {
    const sub = await subscribe(basic);
    await handleRazorpayEvent(eventId(), ev('subscription.charged', sub, 'active', payment(`pay_${suffix}b`, 4999)));
    await handleRazorpayEvent(eventId(), ev('subscription.pending', sub, 'pending', payment(`pay_${suffix}c`, 4999, 'failed')));
    expect((await tenant()).status).toBe('active');
    const mails = await admin`SELECT to_address, subject FROM outbox WHERE tenant_id = ${T} AND template = 'billing_notice' ORDER BY id`;
    expect(mails.map(m => m.to_address).sort()).toEqual(['accounts@billing.test', `bill-${suffix}@example.test`]);
    expect(mails[0].subject).toMatch(/didn’t go through/);

    await handleRazorpayEvent(eventId(), ev('subscription.halted', sub, 'halted'));
    expect(await tenant()).toMatchObject({ status: 'suspended', suspended_for_billing: true });
    await handleRazorpayEvent(eventId(), ev('subscription.charged', sub, 'active', payment(`pay_${suffix}d`, 4999)));
    expect(await tenant()).toMatchObject({ status: 'active', suspended_for_billing: false });
  });

  it('never lifts a suspension made by platform staff, and never suspends a manually billed tenant', async () => {
    const sub = await subscribe(basic);
    await handleRazorpayEvent(eventId(), ev('subscription.charged', sub, 'active', payment(`pay_${suffix}e`, 4999)));
    await admin`UPDATE tenants SET status = 'suspended', suspended_for_billing = false WHERE id = ${T}`;
    await handleRazorpayEvent(eventId(), ev('subscription.charged', sub, 'active', payment(`pay_${suffix}f`, 4999)));
    expect((await tenant()).status).toBe('suspended');
    await expect(startSubscription(T, pro, user, null)).rejects.toMatchObject({ code: 'suspended' });

    await admin`UPDATE tenants SET status = 'active', billing_mode = 'manual' WHERE id = ${T}`;
    await handleRazorpayEvent(eventId(), ev('subscription.halted', sub, 'halted'));
    expect((await tenant()).status).toBe('active');
  });
});

describe('changing and cancelling', () => {
  it('a plan change starts when the paid period ends and replaces the old subscription then', async () => {
    const old = await subscribe(basic);
    const end = new Date(Date.now() + 20 * DAY);
    await handleRazorpayEvent(eventId(), ev('subscription.charged', old, 'active', payment(`pay_${suffix}g`, 4999), [new Date(), end]));
    await expect(startSubscription(T, basic, user, null)).rejects.toMatchObject({ code: 'same_plan' });
    const next = await subscribe(pro);
    expect(new Date((await subRow(next)).starts_at).getTime()).toBe(Math.floor(end.getTime() / 1000) * 1000);
    await handleRazorpayEvent(eventId(), ev('subscription.authenticated', next, 'authenticated'));
    expect(await subRow(old)).toMatchObject({ status: 'active', cancel_at_period_end: true });
    expect((await tenant()).plan_id).toBe(basic);                              // still Basic until the change date

    await handleRazorpayEvent(eventId(), ev('subscription.cancelled', old, 'cancelled'));
    expect((await tenant()).status).toBe('active');                            // the new one is live: no suspension
    await handleRazorpayEvent(eventId(), ev('subscription.charged', next, 'active', payment(`pay_${suffix}h`, 9999)));
    expect((await tenant()).plan_id).toBe(pro);
  });

  it('cancelling keeps access to the period end, then pauses the account', async () => {
    const sub = await subscribe(basic);
    const end = new Date(Date.now() + 5 * DAY);
    await handleRazorpayEvent(eventId(), ev('subscription.charged', sub, 'active', payment(`pay_${suffix}i`, 4999), [new Date(), end]));
    expect((await cancelSubscription(T, user, null))?.getTime()).toBe(Math.floor(end.getTime() / 1000) * 1000);
    expect(await subRow(sub)).toMatchObject({ status: 'active', cancel_at_period_end: true });
    await expect(cancelSubscription(T, user, null)).rejects.toMatchObject({ code: 'none' });
    expect((await tenant()).status).toBe('active');
    await handleRazorpayEvent(eventId(), ev('subscription.cancelled', sub, 'cancelled'));
    expect(await tenant()).toMatchObject({ status: 'suspended', suspended_for_billing: true });
  });

  it('an abandoned checkout that expires changes nothing', async () => {
    const sub = await subscribe(basic);
    await handleRazorpayEvent(eventId(), ev('subscription.cancelled', sub, 'cancelled'));
    expect((await tenant()).status).toBe('active');
  });
});

describe('webhook safety and settings', () => {
  it('accepts only bodies signed with our secret', () => {
    const body = '{"event":"subscription.charged"}';
    expect(verifyWebhook(body, signWebhook(body, 's3cret'), 's3cret')).toBe(true);
    expect(verifyWebhook(body + ' ', signWebhook(body, 's3cret'), 's3cret')).toBe(false);
    expect(verifyWebhook(body, signWebhook(body, 'other'), 's3cret')).toBe(false);
    expect(verifyWebhook(body, null, 's3cret')).toBe(false);
    expect(verifyWebhook(body, 'short', 's3cret')).toBe(false);
    expect(verifyWebhook(body, signWebhook(body, ''), '')).toBe(false);
  });

  it('ignores events for subscriptions it doesn’t know', async () => {
    expect(await handleRazorpayEvent(eventId(), ev('subscription.charged', 'sub_unknown', 'active'))).toBe('ignored');
  });

  it('checks the billing settings', () => {
    expect(billingProblems({})).toEqual([]);
    expect(billingProblems({ BILLING_DRIVER: 'stripe' })).toEqual(['BILLING_DRIVER must be razorpay or fake']);
    expect(billingProblems({ BILLING_DRIVER: 'fake', APP_ENV: 'staging' })).toEqual(['BILLING_DRIVER=fake is for local development only']);
    expect(billingProblems({ BILLING_DRIVER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_x' })).toEqual([
      'RAZORPAY_KEY_SECRET is required when BILLING_DRIVER=razorpay', 'RAZORPAY_WEBHOOK_SECRET is required when BILLING_DRIVER=razorpay']);
    expect(billingProblems({ BILLING_DRIVER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'k', RAZORPAY_WEBHOOK_SECRET: 'w', APP_ENV: 'production' }))
      .toEqual(['RAZORPAY_KEY_ID is a test key in production']);
  });
});
