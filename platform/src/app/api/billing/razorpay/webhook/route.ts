import { handleRazorpayEvent, type RazorpayEvent } from '@/lib/billing/billing';
import { verifyWebhook } from '@/lib/billing/razorpay';
import { billingDriver } from '@/lib/env';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 1_000_000;

// Razorpay → us. Set this URL and the webhook secret in Razorpay Dashboard → Webhooks, with the
// subscription.* and invoice.paid events. Anything not signed with our secret is refused.
// Answers 200 once handled (or already handled); 5xx makes Razorpay retry later.
export async function POST(req: Request) {
  if (!billingDriver()) return new Response('billing off', { status: 404 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return new Response('too large', { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return new Response('too large', { status: 413 });
  if (!verifyWebhook(raw, req.headers.get('x-razorpay-signature'))) {
    log.warn('billing.webhook_bad_signature');
    return new Response('bad signature', { status: 400 });
  }
  let event: RazorpayEvent;
  try { event = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  // Razorpay sends a unique id per event; without one, the signed body itself identifies it.
  const eventId = req.headers.get('x-razorpay-event-id') ?? `body:${(await import('@/lib/crypto')).sha256(raw)}`;
  try {
    const result = await handleRazorpayEvent(eventId, event);
    log.info('billing.webhook', { event: event.event, result });
    return Response.json({ ok: true, result });
  } catch (e) {
    log.error('billing.webhook_failed', e, { event: event.event });
    return new Response('error', { status: 500 });
  }
}
