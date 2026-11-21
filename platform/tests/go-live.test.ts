import { describe, expect, it } from 'vitest';
import { configProblems, demoAccounts } from '../src/lib/env';
import { redactPath } from '../src/lib/log';

const base = { DATABASE_URL: 'x', REDIS_URL: 'x', APP_URL: 'http://localhost', DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') };

describe('start-up configuration check', () => {
  it('accepts a complete development setup', () => expect(configProblems(base)).toEqual([]));

  it('names every missing or malformed setting', () => {
    expect(configProblems({ DATA_ENCRYPTION_KEY: 'short' })).toEqual([
      'DATABASE_URL is not set', 'REDIS_URL is not set', 'APP_URL is not set', 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    ]);
  });

  it('refuses development shortcuts in production', () => {
    const p = configProblems({ ...base, NODE_ENV: 'production', APP_ENV: 'production', SCORING_PROVIDER: 'fake' });
    expect(p).toEqual(expect.arrayContaining([
      'APP_URL must be https:// in production', 'STORAGE_DRIVER must be s3 in production', 'DATABASE_SSL must be verify-full in production',
      'SCORING_PROVIDER=fake is not allowed in production', 'HEALTH_TOKEN must be at least 32 characters',
    ]));
    expect(configProblems({ ...base, NODE_ENV: 'production', APP_ENV: 'production', APP_URL: 'https://a.in', STORAGE_DRIVER: 's3', S3_BUCKET: 'b',
      DATABASE_SSL: 'verify-full', HEALTH_TOKEN: 'x'.repeat(64) })).toEqual([]);
  });
});

describe('demo logins', () => {
  const accounts = { DEV_RECRUITER_EMAIL: 'Recruiter@x.test', DEV_RECRUITER_PASSWORD: 'pw' };
  it('lists the DEV_* accounts only when switched on locally', () => {
    expect(demoAccounts({ ...base, ...accounts })).toEqual([]);
    expect(demoAccounts({ ...base, ...accounts, DEMO_LOGINS: 'on' })).toEqual([{ key: 'recruiter', label: 'Recruiter', email: 'recruiter@x.test', password: 'pw' }]);
  });
  it('never works on AWS, and stops the server starting there', () => {
    for (const APP_ENV of ['staging', 'production']) {
      expect(demoAccounts({ ...base, ...accounts, DEMO_LOGINS: 'on', APP_ENV })).toEqual([]);
      expect(configProblems({ ...base, DEMO_LOGINS: 'on', APP_ENV })).toContain('DEMO_LOGINS is for local development only');
    }
  });
});

describe('log redaction', () => {
  it('never writes candidate link tokens or query strings to the logs', () => {
    expect(redactPath('/i/d6VKuT5maldgi7KOgXyQyLUtbFtxl14gN6GOgEvSI_Y')).toBe('/i/[token]');
    expect(redactPath('/api/i/d6VKuT5maldgi7KOgXyQyLUtbFtxl14gN6GOgEvSI_Y/answer/3?attempt=1')).toBe('/api/i/[token]/answer/3');
    expect(redactPath('/set-password?token=secret')).toBe('/set-password');
    expect(redactPath('/t/acme/jobs')).toBe('/t/acme/jobs');
  });
});
