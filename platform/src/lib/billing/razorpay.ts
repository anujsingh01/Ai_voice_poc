// The few Razorpay calls billing needs, plus a stand-in ("fake") for this computer that needs no
// Razorpay account. Razorpay amounts are in paise; times are Unix seconds.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { billingDriver } from '../env';

export type RazorpaySubscription = { id: string; short_url: string; status: string };

export interface RazorpayApi {
  createPlan(p: { name: string; description: string | null; amountInr: number; period: 'monthly' | 'yearly' }): Promise<string>;
  createSubscription(s: {
    planId: string; totalCount: number; startAt: Date | null; expireBy: Date;
    notes: Record<string, string>; notify: { email: string | null; phone: string | null };
  }): Promise<RazorpaySubscription>;
  cancelSubscription(id: string, atPeriodEnd: boolean): Promise<void>;
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`${process.env.RAZORPAY_API_URL ?? 'https://api.razorpay.com/v1'}${path}`, {
    method, signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay ${path}: ${json?.error?.description ?? res.status}`);
  return json as T;
}

const live: RazorpayApi = {
  async createPlan(p) {
    const r = await call<{ id: string }>('POST', '/plans', {
      period: p.period, interval: 1,
      item: { name: p.name, amount: p.amountInr * 100, currency: 'INR', description: p.description ?? undefined },
    });
    return r.id;
  },
  async createSubscription(s) {
    return call<RazorpaySubscription>('POST', '/subscriptions', {
      plan_id: s.planId, total_count: s.totalCount, quantity: 1, customer_notify: 1,
      ...(s.startAt ? { start_at: unix(s.startAt) } : {}),
      expire_by: unix(s.expireBy), notes: s.notes,
      notify_info: { ...(s.notify.email ? { notify_email: s.notify.email } : {}), ...(s.notify.phone ? { notify_phone: s.notify.phone } : {}) },
    });
  },
  async cancelSubscription(id, atPeriodEnd) {
    await call('POST', `/subscriptions/${id}/cancel`, { cancel_at_cycle_end: atPeriodEnd ? 1 : 0 });
  },
};

// Stand-in: ids look like Razorpay's, and checkout is a local page (/dev/razorpay/<id>) whose buttons send
// signed webhooks to our real webhook endpoint, so everything after "payment" runs the production code.
const fake: RazorpayApi = {
  async createPlan() { return `plan_fake${randomBytes(6).toString('hex')}`; },
  async createSubscription() {
    const id = `sub_fake${randomBytes(6).toString('hex')}`;
    return { id, status: 'created', short_url: `${process.env.APP_URL}/dev/razorpay/${id}` };
  },
  async cancelSubscription() {},
};

export function razorpay(): RazorpayApi {
  const d = billingDriver();
  if (!d) throw new Error('Online billing is not set up');
  return d === 'fake' ? fake : live;
}

export const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || (billingDriver() === 'fake' ? 'fake-webhook-secret' : '');

/** Razorpay signs the raw request body: HMAC-SHA256 with the webhook secret, hex-encoded. */
export function signWebhook(rawBody: string, secret = webhookSecret()) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyWebhook(rawBody: string, signature: string | null, secret = webhookSecret()) {
  if (!secret || !signature) return false;
  const expected = Buffer.from(signWebhook(rawBody, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
