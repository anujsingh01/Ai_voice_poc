import { AuthCard, Button, Field, Notice, messageFor } from '@/components/ui';
import { setPassword } from '../login/actions';

const ERRORS = {
  mismatch: 'The two passwords don’t match.',
  weak: 'Use at least 10 characters, mixing letters with numbers or symbols.',
  expired: 'This link has expired or was already used. Use “Forgot your password?” on the sign-in page, or ask your administrator for a new one.',
};

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const err = messageFor(error, ERRORS);
  if (!token) return <AuthCard title="Set your password"><Notice>{ERRORS.expired}</Notice></AuthCard>;
  return (
    <AuthCard title="Set your password" subtitle="Choose a password for your account.">
      {err && <Notice>{err}</Notice>}
      <form action={setPassword}>
        <input type="hidden" name="token" value={token} />
        <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={10} required
               hint="At least 10 characters, with numbers or symbols." />
        <Field label="Repeat password" name="confirm" type="password" autoComplete="new-password" required />
        <Button className="w-full">Save password</Button>
      </form>
    </AuthCard>
  );
}
