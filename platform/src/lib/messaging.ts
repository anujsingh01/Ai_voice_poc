// Sending SMS and email. Each channel has a driver chosen by settings:
//   EMAIL_DRIVER = ses   Amazon SES (EMAIL_FROM, the sending domain verified in SES)
//                  dev   nothing is sent; messages appear at /dev/mailbox (this computer only, refused on AWS)
//   SMS_DRIVER   = gupshup  Gupshup enterprise SMS with DLT (GUPSHUP_USER, GUPSHUP_PASSWORD,
//                           GUPSHUP_DLT_ENTITY_ID, GUPSHUP_DLT_TEMPLATES="invite=…,deletion_notice=…")
//                  dev
// A channel with no driver is "off": its messages wait in the outbox as queued, and recruiters share
// links themselves. WhatsApp has no driver yet (Gupshup WhatsApp needs approved templates).
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { sql, withContext } from '@/db';
import { driverFor, enabledChannels, type Channel } from './env';
import { log } from './log';

export type Message = { channel: Channel; to: string; subject?: string | null; body: string; template?: string | null };

/** Sends one message now. Throws if the provider refuses it; returns the provider's message id. */
export async function deliver(m: Message): Promise<string | null> {
  const driver = driverFor(m.channel);
  if (!driver) throw new Error(`${m.channel} sending is not set up`);
  if (driver === 'dev') {
    const [r] = await sql`INSERT INTO dev_mailbox (channel, to_address, subject, body) VALUES (${m.channel}, ${m.to}, ${m.subject ?? null}, ${m.body}) RETURNING id`;
    return `dev-${r.id}`;
  }
  if (driver === 'ses') return sendSes(m);
  return sendGupshupSms(m);
}

const g = globalThis as unknown as { ses?: SESv2Client };

async function sendSes(m: Message) {
  g.ses ??= new SESv2Client({ region: process.env.SES_REGION ?? process.env.AWS_REGION ?? 'ap-south-1' });
  const r = await g.ses.send(new SendEmailCommand({
    FromEmailAddress: process.env.EMAIL_FROM,
    Destination: { ToAddresses: [m.to] },
    Content: { Simple: { Subject: { Data: m.subject ?? '', Charset: 'UTF-8' }, Body: { Text: { Data: m.body, Charset: 'UTF-8' } } } },
    ...(process.env.SES_CONFIGURATION_SET ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET } : {}),
  }));
  return r.MessageId ?? null;
}

/** "invite=1107…,deletion_notice=1107…" → the DLT template id registered for this kind of message. */
export function dltTemplateId(template: string | null | undefined, setting = process.env.GUPSHUP_DLT_TEMPLATES ?? '') {
  const map = Object.fromEntries(setting.split(',').map(p => p.split('=').map(s => s.trim())).filter(p => p.length === 2 && p[0] && p[1]));
  return template ? map[template] ?? null : null;
}

async function sendGupshupSms(m: Message) {
  const templateId = dltTemplateId(m.template);
  // Without the registered template id, Indian operators drop the SMS, so fail loudly instead.
  if (!templateId) throw new Error(`no DLT template id for "${m.template ?? '(none)'}" in GUPSHUP_DLT_TEMPLATES`);
  const form = new URLSearchParams({
    method: 'SendMessage', v: '1.1', format: 'json', msg_type: 'TEXT', auth_scheme: 'plain',
    userid: process.env.GUPSHUP_USER!, password: process.env.GUPSHUP_PASSWORD!,
    send_to: m.to.replace(/^\+/, ''), msg: m.body,
    principalEntityId: process.env.GUPSHUP_DLT_ENTITY_ID!, dltTemplateId: templateId,
    ...(process.env.GUPSHUP_SENDER_ID ? { mask: process.env.GUPSHUP_SENDER_ID } : {}),
  });
  const res = await fetch(process.env.GUPSHUP_SMS_URL ?? 'https://enterprise.smsgupshup.com/GatewayAPI/rest', {
    method: 'POST', body: form, signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: { response?: { status?: string; id?: string; details?: string } } = {};
  try { body = JSON.parse(text); } catch { /* reported below */ }
  if (!res.ok || body.response?.status !== 'success') throw new Error(`Gupshup: ${body.response?.details ?? text.slice(0, 200)}`);
  return body.response.id ?? null;
}

const MAX_ATTEMPTS = 5;
// Provider errors can quote the address; logs must not hold personal data.
const redact = (s: string) => s.replace(/\S+@\S+/g, '[email]').replace(/\+?\d{10,}/g, '[phone]');

/**
 * Sends queued outbox messages for the channels that have a driver. Rows are claimed with a 5-minute
 * lease (two senders never send the same message); failures retry after 1, 4, 9, 16 minutes, then fail.
 */
export async function sendQueued(limit = 20) {
  const channels = enabledChannels();
  if (!channels.length) return { sent: 0, failed: 0, retrying: 0 };
  const claimed = await withContext({ superAdmin: true }, tx => tx`
    WITH c AS (
      SELECT id FROM outbox
      WHERE status = 'queued' AND channel = ANY(${channels}::message_channel[]) AND coalesce(next_attempt_at, created_at) <= now()
      ORDER BY coalesce(next_attempt_at, created_at) LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    UPDATE outbox o SET attempts = o.attempts + 1, next_attempt_at = now() + interval '5 minutes'
    FROM c WHERE o.id = c.id
    RETURNING o.id, o.channel, o.to_address, o.subject, o.body, o.template, o.attempts`);
  const out = { sent: 0, failed: 0, retrying: 0 };
  for (const m of claimed) {
    try {
      const providerId = await deliver({ channel: m.channel, to: m.to_address, subject: m.subject, body: m.body, template: m.template });
      await withContext({ superAdmin: true }, tx => tx`
        UPDATE outbox SET status = 'sent', sent_at = now(), provider_id = ${providerId}, error = NULL WHERE id = ${m.id}`);
      out.sent++;
    } catch (e) {
      const error = (e as Error).message.slice(0, 500);
      const final = m.attempts >= MAX_ATTEMPTS;
      await withContext({ superAdmin: true }, tx => tx`
        UPDATE outbox SET error = ${error},
          status = ${final ? 'failed' : 'queued'},
          next_attempt_at = now() + make_interval(mins => ${m.attempts * m.attempts})
        WHERE id = ${m.id}`);
      log.warn('message.send_failed', { id: m.id, channel: m.channel, attempt: m.attempts, error: redact(error) });
      if (final) out.failed++; else out.retrying++;
    }
  }
  return out;
}
