// Settings the app can't run without. Checked once at server start, so a bad deploy fails its health
// check immediately instead of erroring on the first real request.
const REQUIRED = ['DATABASE_URL', 'REDIS_URL', 'APP_URL', 'DATA_ENCRYPTION_KEY'] as const;

export function configProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems = REQUIRED.filter(k => !env[k]).map(k => `${k} is not set`);
  if (env.DATA_ENCRYPTION_KEY && Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').length !== 32) problems.push('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) problems.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
  if (env.NODE_ENV === 'production' && env.APP_ENV === 'production') {
    if (!env.APP_URL?.startsWith('https://')) problems.push('APP_URL must be https:// in production');
    if (env.STORAGE_DRIVER !== 's3') problems.push('STORAGE_DRIVER must be s3 in production');
    if (env.DATABASE_SSL !== 'verify-full') problems.push('DATABASE_SSL must be verify-full in production');
    if (env.SCORING_PROVIDER === 'fake') problems.push('SCORING_PROVIDER=fake is not allowed in production');
    if (!env.HEALTH_TOKEN || env.HEALTH_TOKEN.length < 32) problems.push('HEALTH_TOKEN must be at least 32 characters');
  }
  if (env.DEMO_LOGINS && !isLocal(env)) problems.push('DEMO_LOGINS is for local development only');
  return [...problems, ...messagingProblems(env), ...billingProblems(env)];
}

/** This computer, not an AWS deployment (which always sets APP_ENV to staging or production). */
export const isLocal = (env: Record<string, string | undefined> = process.env) => !env.APP_ENV || env.APP_ENV === 'development';

// ---------- Demo logins ----------
// DEMO_LOGINS=on adds one-click sign-in buttons for the DEV_* test accounts to /login, skipping 2-step
// login. This computer only: the server refuses to start with it set on AWS.
export const DEMO_ACCOUNTS = [
  { key: 'super_admin', label: 'Platform super admin', prefix: 'DEV_SUPER_ADMIN' },
  { key: 'support', label: 'Platform support', prefix: 'DEV_SUPPORT' },
  { key: 'tenant_admin', label: 'Company admin (HR)', prefix: 'DEV_TENANT_ADMIN' },
  { key: 'recruiter', label: 'Recruiter', prefix: 'DEV_RECRUITER' },
  { key: 'reviewer', label: 'Reviewer', prefix: 'DEV_REVIEWER' },
] as const;

export function demoAccounts(env: Record<string, string | undefined> = process.env) {
  if (env.DEMO_LOGINS !== 'on' || !isLocal(env)) return [];
  return DEMO_ACCOUNTS.flatMap(a => {
    const email = env[`${a.prefix}_EMAIL`]?.trim().toLowerCase(), password = env[`${a.prefix}_PASSWORD`];
    return email ? [{ key: a.key, label: a.label, email, password: password ?? '' }] : [];
  });
}

export type Channel = 'sms' | 'whatsapp' | 'email';
const DRIVERS: Record<Channel, readonly string[]> = { email: ['ses', 'dev'], sms: ['gupshup', 'dev'], whatsapp: [] };
const SETTING: Record<Channel, string> = { email: 'EMAIL_DRIVER', sms: 'SMS_DRIVER', whatsapp: 'WHATSAPP_DRIVER' };

export function driverFor(channel: Channel, env: Record<string, string | undefined> = process.env): string | null {
  const d = env[SETTING[channel]];
  return d && DRIVERS[channel].includes(d) ? d : null;
}

export const enabledChannels = (env = process.env) => (Object.keys(DRIVERS) as Channel[]).filter(c => driverFor(c, env));

/** Settings problems for the sending drivers (reported at server start with the other config checks). */
export function messagingProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  for (const c of Object.keys(DRIVERS) as Channel[]) {
    const d = env[SETTING[c]];
    if (d && !DRIVERS[c].includes(d)) problems.push(`${SETTING[c]} must be one of: ${DRIVERS[c].join(', ') || '(none yet)'}`);
    if (d === 'dev' && !isLocal(env)) problems.push(`${SETTING[c]}=dev is for local development only`);
  }
  if (env.EMAIL_DRIVER === 'ses' && !env.EMAIL_FROM) problems.push('EMAIL_FROM is required when EMAIL_DRIVER=ses');
  if (env.SMS_DRIVER === 'gupshup') {
    for (const k of ['GUPSHUP_USER', 'GUPSHUP_PASSWORD', 'GUPSHUP_DLT_ENTITY_ID', 'GUPSHUP_DLT_TEMPLATES']) if (!env[k]) problems.push(`${k} is required when SMS_DRIVER=gupshup`);
  }
  return problems;
}

// ---------- Billing ----------
//   BILLING_DRIVER = razorpay  Razorpay Subscriptions (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET)
//                    fake      a stand-in checkout at /dev/razorpay (this computer only, refused on AWS)
// Unset: no online payment; platform staff assign plans and invoice outside the platform.
export type BillingDriver = 'razorpay' | 'fake';

export function billingDriver(env: Record<string, string | undefined> = process.env): BillingDriver | null {
  return env.BILLING_DRIVER === 'razorpay' || env.BILLING_DRIVER === 'fake' ? env.BILLING_DRIVER : null;
}

export function billingProblems(env: Record<string, string | undefined> = process.env): string[] {
  const d = env.BILLING_DRIVER;
  if (!d) return [];
  if (d !== 'razorpay' && d !== 'fake') return ['BILLING_DRIVER must be razorpay or fake'];
  if (d === 'fake') return isLocal(env) ? [] : ['BILLING_DRIVER=fake is for local development only'];
  const problems = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'].filter(k => !env[k]).map(k => `${k} is required when BILLING_DRIVER=razorpay`);
  if (env.APP_ENV === 'production' && env.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) problems.push('RAZORPAY_KEY_ID is a test key in production');
  return problems;
}
