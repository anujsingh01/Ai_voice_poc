import Link from 'next/link';
import { AuthCard, Button, Field, Notice, messageFor } from '@/components/ui';
import { driverFor } from '@/lib/env';
import { requestPasswordReset } from '../login/actions';

const ERRORS = { too_many: 'Too many requests. Please wait an hour and try again.' };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { error, msg } = await searchParams;
  const err = messageFor(error, ERRORS);
  const back = <p className="mt-5 text-center text-sm"><Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">Back to sign in</Link></p>;
  if (!driverFor('email')) {
    return (
      <AuthCard title="Forgot your password?">
        <Notice kind="info">Email isn’t set up on this platform yet. Ask your administrator to send you a new set-password link.</Notice>
        {back}
      </AuthCard>
    );
  }
  if (msg === 'sent') {
    return (
      <AuthCard title="Check your email">
        <Notice kind="success">
          If an account uses that address, we’ve sent it a link to choose a new password. The link works once, for 1 hour.
        </Notice>
        <p className="text-sm text-slate-600">No email after a few minutes? Check your spam folder, or ask your administrator.</p>
        {back}
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your work email and we’ll send you a link to choose a new one.">
      {err && <Notice>{err}</Notice>}
      <form action={requestPasswordReset}>
        <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
        <Button className="w-full">Send reset link</Button>
      </form>
      {back}
    </AuthCard>
  );
}
