// Backup codes for 2-step login, the message sender (dev driver, retries) and the sending settings checks.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@/db';
import { configProblems, driverFor, messagingProblems } from '@/lib/env';
import { dltTemplateId, sendQueued } from '@/lib/messaging';
import { createRecoveryCodes, normaliseRecoveryCode, remainingRecoveryCodes, redeemRecoveryCode } from '@/lib/totp';

const admin = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
const suffix = Date.now().toString(36);
const saved = { EMAIL_DRIVER: process.env.EMAIL_DRIVER, SMS_DRIVER: process.env.SMS_DRIVER, GUPSHUP_DLT_TEMPLATES: process.env.GUPSHUP_DLT_TEMPLATES };
let T: string, U: string, other: string;

beforeAll(async () => {
  [{ id: T }] = await admin`INSERT INTO tenants (name, slug) VALUES ('Recovery Co', ${'rec-' + suffix}) RETURNING id`;
  [{ id: U }] = await admin`INSERT INTO users (email, name) VALUES (${`rec-${suffix}@example.test`}, 'Rec User') RETURNING id`;
  [{ id: other }] = await admin`INSERT INTO users (email, name) VALUES (${`rec2-${suffix}@example.test`}, 'Other User') RETURNING id`;
});

afterAll(async () => {
  Object.assign(process.env, saved);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  await admin`DELETE FROM tenants WHERE id = ${T}`;
  await admin`DELETE FROM users WHERE id IN (${U}, ${other})`;
  await admin`DELETE FROM dev_mailbox WHERE to_address LIKE ${'cand-%@example.test'}`;
  await Promise.all([admin.end(), sql.end()]);
});

describe('2-step backup codes', () => {
  it('gives 10 readable codes, each working once and only for its owner', async () => {
    const codes = await createRecoveryCodes(U);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
    const stored = await admin`SELECT code_hash FROM recovery_codes WHERE user_id = ${U}`;
    expect(stored.map(r => r.code_hash)).not.toContain(codes[0]);               // only hashes are stored

    expect(await redeemRecoveryCode(other, codes[0])).toBeNull();                   // someone else's code
    expect(await redeemRecoveryCode(U, ` ${codes[0].toUpperCase()} `)).toBe(9);     // forgiving about case and spaces
    expect(await redeemRecoveryCode(U, codes[0])).toBeNull();                       // used up
    expect(await redeemRecoveryCode(U, 'abcde-fghij')).toBeNull();
    expect(await redeemRecoveryCode(U, '123456')).toBeNull();
    expect(normaliseRecoveryCode('AB CD-e')).toBe('abcde');
  });

  it('replaces the old codes when new ones are made', async () => {
    const old = await createRecoveryCodes(U);
    const fresh = await createRecoveryCodes(U);
    expect(await redeemRecoveryCode(U, old[1])).toBeNull();
    expect(await remainingRecoveryCodes(U)).toBe(10);
    expect(await redeemRecoveryCode(U, fresh[1])).toBe(9);
  });
});

describe('message sender', () => {
  it('delivers queued messages through the dev driver and marks them sent', async () => {
    process.env.EMAIL_DRIVER = 'dev'; process.env.SMS_DRIVER = 'dev';
    const to = `cand-${suffix}@example.test`;
    const [m] = await admin`INSERT INTO outbox (tenant_id, template, channel, to_address, subject, body)
                            VALUES (${T}, 'invite', 'email', ${to}, 'Your interview', 'Hello') RETURNING id`;
    while ((await sendQueued()).sent > 0) { /* drain everything queued */ }
    const [row] = await admin`SELECT status, sent_at, attempts, provider_id FROM outbox WHERE id = ${m.id}`;
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    expect(row.provider_id).toMatch(/^dev-\d+$/);
    const [mail] = await admin`SELECT subject, body FROM dev_mailbox WHERE to_address = ${to}`;
    expect(mail).toMatchObject({ subject: 'Your interview', body: 'Hello' });
  });

  it('retries a failed SMS with back-off and records why', async () => {
    process.env.SMS_DRIVER = 'gupshup'; process.env.GUPSHUP_DLT_TEMPLATES = 'invite=1107000000000000001';
    const [m] = await admin`INSERT INTO outbox (tenant_id, template, channel, to_address, body)
                            VALUES (${T}, 'unregistered_kind', 'sms', '+919800000001', 'Hi') RETURNING id`;
    await admin`UPDATE outbox SET next_attempt_at = now() + interval '1 hour' WHERE status = 'queued' AND channel = 'sms' AND id <> ${m.id}`;
    const r = await sendQueued();
    expect(r.retrying).toBeGreaterThanOrEqual(1);
    const [row] = await admin`SELECT status, attempts, error, next_attempt_at > now() AS later FROM outbox WHERE id = ${m.id}`;
    expect(row).toMatchObject({ status: 'queued', attempts: 1, later: true });
    expect(row.error).toContain('no DLT template id for "unregistered_kind"');

    await admin`UPDATE outbox SET attempts = 4, next_attempt_at = now() - interval '1 second' WHERE id = ${m.id}`;
    await sendQueued();
    const [last] = await admin`SELECT status, attempts FROM outbox WHERE id = ${m.id}`;
    expect(last).toMatchObject({ status: 'failed', attempts: 5 });              // gives up after 5 tries
  });

  it('leaves messages queued for a channel with no driver', async () => {
    delete process.env.SMS_DRIVER; delete process.env.EMAIL_DRIVER;
    const [m] = await admin`INSERT INTO outbox (tenant_id, template, channel, to_address, body) VALUES (${T}, 'invite', 'sms', '+919800000002', 'Hi') RETURNING id`;
    expect(await sendQueued()).toEqual({ sent: 0, failed: 0, retrying: 0 });
    expect((await admin`SELECT status, attempts FROM outbox WHERE id = ${m.id}`)[0]).toMatchObject({ status: 'queued', attempts: 0 });
  });
});

describe('sending settings', () => {
  it('reads DLT template ids per message kind', () => {
    expect(dltTemplateId('invite', 'invite=111, deletion_notice=222')).toBe('111');
    expect(dltTemplateId('deletion_notice', 'invite=111, deletion_notice=222')).toBe('222');
    expect(dltTemplateId('other', 'invite=111')).toBeNull();
    expect(dltTemplateId(null, 'invite=111')).toBeNull();
  });

  it('refuses the dev driver in production and incomplete provider settings', () => {
    expect(driverFor('email', { EMAIL_DRIVER: 'smtp' })).toBeNull();
    expect(messagingProblems({ EMAIL_DRIVER: 'smtp' })).toEqual(['EMAIL_DRIVER must be one of: ses, dev']);
    expect(messagingProblems({ EMAIL_DRIVER: 'dev', APP_ENV: 'staging' })).toEqual(['EMAIL_DRIVER=dev is for local development only']);
    expect(messagingProblems({ EMAIL_DRIVER: 'dev', NODE_ENV: 'production' })).toEqual([]);   // a local production build
    expect(messagingProblems({ EMAIL_DRIVER: 'ses' })).toEqual(['EMAIL_FROM is required when EMAIL_DRIVER=ses']);
    expect(messagingProblems({ SMS_DRIVER: 'gupshup', GUPSHUP_USER: 'u', GUPSHUP_PASSWORD: 'p', GUPSHUP_DLT_ENTITY_ID: 'e' }))
      .toEqual(['GUPSHUP_DLT_TEMPLATES is required when SMS_DRIVER=gupshup']);
    expect(messagingProblems({ WHATSAPP_DRIVER: 'gupshup' })).toEqual(['WHATSAPP_DRIVER must be one of: (none yet)']);
    expect(configProblems({ DATABASE_URL: 'x', REDIS_URL: 'x', APP_URL: 'x', DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), SMS_DRIVER: 'dev', NODE_ENV: 'production', APP_ENV: 'production' }))
      .toContain('SMS_DRIVER=dev is for local development only');
  });
});
