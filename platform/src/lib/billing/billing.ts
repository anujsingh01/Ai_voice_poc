// Online billing: subscribing, cancelling, and acting on Razorpay's webhooks.
//
// The rules, in one place:
// - A tenant admin picks a "self-serve" plan and pays on Razorpay's page. The subscription starts now,
//   or when their trial ends, or (plan change) when the current paid period ends.
// - Each successful charge makes the tenant active on that plan (limits included).
// - A failed charge is retried by Razorpay ("pending"); when all retries fail ("halted") the tenant is
//   suspended. Only a payment-caused suspension is lifted by a later payment; one made by staff isn't.
// - Cancelling stops renewal; access continues to the end of the paid period, then the tenant is suspended.
// - Tenants on 'manual' billing (assigned by staff) are never suspended or changed by any of this.
import { withContext, type Tx } from '@/db';
import { audit } from '../audit';
import { log } from '../log';
import { applyPlan, type Plan } from '../plans';
import { razorpay } from './razorpay';

export class BillingError extends Error {
  constructor(public code: 'plan' | 'details' | 'same_plan' | 'suspended' | 'none') { super(code); }
}

const LIVE = ['authenticated', 'active', 'pending'];          // will charge, or is charging
const WAS_PAYING = ['active', 'pending', 'halted', 'paused'];
const asPlatform = <T,>(fn: (tx: Tx) => Promise<T>) => withContext({ superAdmin: true }, fn);
const date = (unixSeconds: number | null | undefined) => (unixSeconds ? new Date(unixSeconds * 1000) : null);
const inIndia = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** The Razorpay plan for this plan at its current price (Razorpay plans can't change price, so a new one is made). */
async function razorpayPlanFor(tx: Tx, plan: Plan & { razorpay_plan_id: string | null; razorpay_plan_price_inr: number | null }) {
  if (plan.razorpay_plan_id && plan.razorpay_plan_price_inr === plan.price_inr) return plan.razorpay_plan_id;
  const id = await razorpay().createPlan({ name: plan.name, description: plan.description, amountInr: plan.price_inr, period: plan.billing_period });
  await tx`UPDATE plans SET razorpay_plan_id = ${id}, razorpay_plan_price_inr = ${plan.price_inr} WHERE id = ${plan.id}`;
  return id;
}

/** Starts a subscription and returns Razorpay's payment page for the tenant admin to complete. */
export async function startSubscription(tenantId: string, planId: string, userId: string, ip: string | null) {
  return asPlatform(async tx => {
    const [plan] = await tx`SELECT * FROM plans WHERE id = ${planId} AND self_serve AND NOT archived AND price_inr > 0`;
    if (!plan) throw new BillingError('plan');
    const [t] = await tx`SELECT * FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
    if (!t.billing_name || !t.billing_email) throw new BillingError('details');
    if (t.status === 'suspended' && !t.suspended_for_billing) throw new BillingError('suspended');
    const live = await tx`SELECT * FROM billing_subscriptions WHERE tenant_id = ${tenantId} AND status IN ${tx(LIVE)} AND NOT cancel_at_period_end`;
    if (live.some(s => s.plan_id === planId)) throw new BillingError('same_plan');

    // Paid until a date already: the new plan takes over then. In a trial: the first charge is when it ends.
    const [paidUntil] = await tx`SELECT max(current_end) AS until FROM billing_subscriptions
                                 WHERE tenant_id = ${tenantId} AND status = 'active' AND current_end > now()`;
    const startAt: Date | null = paidUntil.until ?? (t.status === 'trial' && t.trial_ends_at > new Date() ? t.trial_ends_at : null);

    const sub = await razorpay().createSubscription({
      planId: await razorpayPlanFor(tx, plan as never),
      totalCount: plan.billing_period === 'monthly' ? 120 : 10,       // renews for up to 10 years
      startAt, expireBy: new Date(Date.now() + 2 * 86400e3),            // the payment link is good for 2 days
      notes: { tenant_id: tenantId, plan: plan.name, billing_name: t.billing_name, ...(t.gstin ? { gstin: t.gstin } : {}) },
      notify: { email: t.billing_email, phone: t.billing_phone },
    });
    await tx`INSERT INTO billing_subscriptions (tenant_id, plan_id, razorpay_subscription_id, status, price_inr, billing_period, checkout_url, starts_at, created_by)
             VALUES (${tenantId}, ${planId}, ${sub.id}, ${sub.status}, ${plan.price_inr}, ${plan.billing_period}, ${sub.short_url}, ${startAt}, ${userId})`;
    await audit(tx, { tenantId, actorUserId: userId, action: 'billing.subscription_started', target: sub.id, details: { plan: plan.name, price_inr: plan.price_inr, starts_at: startAt }, ip });
    return sub.short_url;
  });
}

/** Stops renewal. The paid period continues; a plan change that hasn't started yet is dropped. */
export async function cancelSubscription(tenantId: string, userId: string, ip: string | null) {
  return asPlatform(async tx => {
    const live = await tx`SELECT * FROM billing_subscriptions WHERE tenant_id = ${tenantId} AND status IN ${tx(LIVE)} AND NOT cancel_at_period_end FOR UPDATE`;
    if (!live.length) throw new BillingError('none');
    let endsAt: Date | null = null;
    for (const s of live) {
      const started = s.status !== 'authenticated';
      await razorpay().cancelSubscription(s.razorpay_subscription_id, started);
      await tx`UPDATE billing_subscriptions SET cancel_at_period_end = true, status = ${started ? s.status : 'cancelled'}, updated_at = now() WHERE id = ${s.id}`;
      if (started && s.current_end) endsAt = s.current_end;
    }
    await audit(tx, { tenantId, actorUserId: userId, action: 'billing.subscription_cancelled', details: { ends_at: endsAt }, ip });
    return endsAt;
  });
}

async function notifyAdmins(tx: Tx, tenantId: string, subject: string, body: string) {
  const people = await tx`
    SELECT DISTINCT u.email FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId} AND m.role = 'tenant_admin' AND NOT u.disabled
    UNION SELECT billing_email FROM tenants WHERE id = ${tenantId} AND billing_email IS NOT NULL`;
  for (const p of people) {
    await tx`INSERT INTO outbox (tenant_id, template, channel, to_address, subject, body)
             VALUES (${tenantId}, 'billing_notice', 'email', ${p.email}, ${subject}, ${body})`;
  }
}

const billingLink = (slug: string) => `${process.env.APP_URL}/t/${slug}/billing`;

type Entity = Record<string, unknown> & { id: string };
export type RazorpayEvent = {
  event: string;
  payload: { subscription?: { entity: Entity }; payment?: { entity: Entity }; invoice?: { entity: Entity } };
};

async function recordPayment(tx: Tx, tenantId: string, subscriptionId: number, p: {
  paymentId: string; invoiceId?: string | null; invoiceUrl?: string | null; amountPaise: number; status: string;
  method?: string | null; error?: string | null; periodStart?: Date | null; periodEnd?: Date | null;
}) {
  await tx`
    INSERT INTO billing_payments (tenant_id, subscription_id, razorpay_payment_id, razorpay_invoice_id, invoice_url, amount_inr, status, method, error, period_start, period_end)
    VALUES (${tenantId}, ${subscriptionId}, ${p.paymentId}, ${p.invoiceId ?? null}, ${p.invoiceUrl ?? null}, ${p.amountPaise / 100}, ${p.status},
            ${p.method ?? null}, ${p.error ?? null}, ${p.periodStart ?? null}, ${p.periodEnd ?? null})
    ON CONFLICT (razorpay_payment_id) DO UPDATE SET
      razorpay_invoice_id = coalesce(EXCLUDED.razorpay_invoice_id, billing_payments.razorpay_invoice_id),
      invoice_url = coalesce(EXCLUDED.invoice_url, billing_payments.invoice_url),
      status = CASE WHEN billing_payments.status = 'captured' THEN 'captured' ELSE EXCLUDED.status END,
      method = coalesce(EXCLUDED.method, billing_payments.method),
      period_start = coalesce(EXCLUDED.period_start, billing_payments.period_start),
      period_end = coalesce(EXCLUDED.period_end, billing_payments.period_end)`;
}

/**
 * Applies one verified Razorpay webhook. Runs once per event id (Razorpay may deliver an event twice);
 * if it throws, nothing is kept and Razorpay's retry runs it again.
 */
export async function handleRazorpayEvent(eventId: string, e: RazorpayEvent): Promise<'done' | 'duplicate' | 'ignored'> {
  return asPlatform(async tx => {
    const [fresh] = await tx`INSERT INTO billing_webhook_events (event_id, event) VALUES (${eventId}, ${e.event}) ON CONFLICT DO NOTHING RETURNING 1`;
    if (!fresh) return 'duplicate';
    const subEntity = e.payload.subscription?.entity;
    const payment = e.payload.payment?.entity;
    const invoice = e.payload.invoice?.entity;
    const rzSubId = subEntity?.id ?? (invoice?.subscription_id as string | undefined);
    if (!rzSubId) return 'ignored';
    const [sub] = await tx`SELECT s.*, t.slug, t.name AS tenant_name, p.name AS plan_name FROM billing_subscriptions s
                           JOIN tenants t ON t.id = s.tenant_id JOIN plans p ON p.id = s.plan_id
                           WHERE s.razorpay_subscription_id = ${rzSubId} FOR UPDATE OF s`;
    if (!sub) { log.warn('billing.unknown_subscription', { event: e.event }); return 'ignored'; }
    const T = sub.tenant_id as string;
    const before = sub.status as string;

    if (subEntity) {
      await tx`UPDATE billing_subscriptions SET status = ${subEntity.status as string},
                 current_start = coalesce(${date(subEntity.current_start as number)}, current_start),
                 current_end = coalesce(${date(subEntity.current_end as number)}, current_end), updated_at = now()
               WHERE id = ${sub.id}`;
    }
    const event = (action: string, details?: Record<string, unknown>) =>
      audit(tx, { tenantId: T, action, target: rzSubId, details: { razorpay_event: e.event, ...details } });

    switch (e.event) {
      case 'subscription.authenticated': {
        // Payment method approved. Replace whatever else this tenant was subscribed to.
        // (A halted one is closed too, so Razorpay can never resume charging it.)
        const others = await tx`SELECT * FROM billing_subscriptions WHERE tenant_id = ${T} AND id <> ${sub.id}
                                AND (status = 'halted' OR (status IN ${tx(LIVE)} AND NOT cancel_at_period_end))`;
        const startsLater = sub.starts_at && new Date(sub.starts_at) > new Date();
        for (const o of others) {
          const atPeriodEnd = startsLater && o.status === 'active';
          await razorpay().cancelSubscription(o.razorpay_subscription_id, atPeriodEnd);
          await tx`UPDATE billing_subscriptions SET cancel_at_period_end = true, status = ${atPeriodEnd ? o.status : 'cancelled'}, updated_at = now() WHERE id = ${o.id}`;
        }
        await tx`UPDATE tenants SET billing_mode = 'razorpay', updated_at = now() WHERE id = ${T}`;
        await event('billing.authenticated', { replaced: others.length });
        break;
      }
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed': {
        if (payment) {
          await recordPayment(tx, T, sub.id, {
            paymentId: payment.id, invoiceId: payment.invoice_id as string, amountPaise: payment.amount as number,
            status: payment.status as string, method: payment.method as string,
            periodStart: date(subEntity?.current_start as number), periodEnd: date(subEntity?.current_end as number),
          });
        }
        const [t] = await tx`SELECT t.plan_id, t.status, t.suspended_for_billing, coalesce(l.custom, false) AS custom
                             FROM tenants t LEFT JOIN tenant_limits l ON l.tenant_id = t.id WHERE t.id = ${T}`;
        if (t.status === 'suspended' && !t.suspended_for_billing) { await event('billing.paid_while_suspended_by_staff'); break; }
        // The paid plan's limits apply, except limits staff set by hand for this tenant on the same plan.
        if (t.plan_id !== sub.plan_id || !t.custom) await applyPlan(tx, T, sub.plan_id, null);
        await tx`UPDATE tenants SET status = 'active', trial_ends_at = NULL, suspended_for_billing = false, billing_mode = 'razorpay', updated_at = now() WHERE id = ${T}`;
        if (t.status === 'suspended') {
          await notifyAdmins(tx, T, 'Payment received: your account is active again',
            `Thank you. We received your payment for ${sub.plan_name}, and ${sub.tenant_name} is active again.\n\n${billingLink(sub.slug)}`);
        }
        await event(e.event === 'subscription.charged' ? 'billing.charged' : 'billing.activated', payment ? { amount_inr: (payment.amount as number) / 100 } : undefined);
        break;
      }
      case 'subscription.pending': {
        if (payment) await recordPayment(tx, T, sub.id, { paymentId: payment.id, amountPaise: payment.amount as number, status: 'failed', method: payment.method as string, error: payment.error_description as string });
        if (before !== 'pending') {
          await notifyAdmins(tx, T, 'Your subscription payment didn’t go through',
            `We couldn’t charge ${sub.tenant_name}'s ${sub.plan_name} subscription. Razorpay will try again over the next few days; ` +
            `if every try fails, the account will be paused until it's paid.\n\nCheck the card or UPI mandate, or pay now: ${billingLink(sub.slug)}`);
        }
        await event('billing.payment_failed');
        break;
      }
      case 'subscription.halted': {
        const [s] = await tx`UPDATE tenants SET status = 'suspended', suspended_for_billing = true, updated_at = now()
                             WHERE id = ${T} AND billing_mode = 'razorpay' AND status <> 'suspended' RETURNING 1`;
        if (s) {
          await notifyAdmins(tx, T, 'Your account is paused: payment needed',
            `All attempts to charge ${sub.tenant_name}'s ${sub.plan_name} subscription failed, so the account is paused. ` +
            `Your data is safe and visible; new interviews can't start until it's paid.\n\nChoose a plan and pay: ${billingLink(sub.slug)}`);
        }
        await event('billing.halted', { suspended: !!s });
        break;
      }
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.expired': {
        const [other] = await tx`SELECT 1 FROM billing_subscriptions WHERE tenant_id = ${T} AND id <> ${sub.id} AND status IN ${tx(LIVE)} LIMIT 1`;
        let suspended = false;
        if (WAS_PAYING.includes(before) && !other) {
          const [s] = await tx`UPDATE tenants SET status = 'suspended', suspended_for_billing = true, updated_at = now()
                               WHERE id = ${T} AND billing_mode = 'razorpay' AND status <> 'suspended' RETURNING 1`;
          suspended = !!s;
          if (s) {
            await notifyAdmins(tx, T, 'Your subscription has ended',
              `${sub.tenant_name}'s ${sub.plan_name} subscription ended on ${inIndia(new Date())}, so the account is paused. ` +
              `Your data stays visible until it's deleted under your retention settings. To continue, choose a plan: ${billingLink(sub.slug)}`);
          }
        }
        await event('billing.ended', { suspended });
        break;
      }
      case 'invoice.paid': {
        if (invoice?.payment_id) {
          await recordPayment(tx, T, sub.id, {
            paymentId: invoice.payment_id as string, invoiceId: invoice.id, invoiceUrl: invoice.short_url as string,
            amountPaise: invoice.amount_paid as number, status: 'captured',
            periodStart: date(invoice.billing_start as number), periodEnd: date(invoice.billing_end as number),
          });
        }
        break;
      }
      default:
        return 'ignored';
    }
    return 'done';
  });
}
