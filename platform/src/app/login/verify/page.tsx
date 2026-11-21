import { redirect } from 'next/navigation';
import { AuthCard, Button, Field, Notice, messageFor } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { verifyCode } from '../actions';

const ERRORS = {
  invalid: 'That code is not right, or it was already used. Wait for the next code and try again, or use a backup code.',
  too_many: 'Too many attempts. Please wait 5 minutes.',
};

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (!s.user.totp_enabled) redirect('/setup-2fa');
  if (s.twoFactorPassed) redirect('/');
  const err = messageFor((await searchParams).error, ERRORS);
  return (
    <AuthCard title="2-step verification" subtitle="Enter the 6-digit code from your authenticator app.">
      {err && <Notice>{err}</Notice>}
      <form action={verifyCode}>
        <Field label="Code" name="code" autoComplete="one-time-code" maxLength={12} required autoFocus
               hint="Lost your phone? Enter one of your backup codes (like abcde-fghij) instead." />
        <Button className="w-full">Verify</Button>
      </form>
    </AuthCard>
  );
}
