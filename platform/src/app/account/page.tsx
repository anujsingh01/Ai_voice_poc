import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { Button, Field, Notice, PageHeader, Section, messageFor } from '@/components/ui';
import { requires2fa, requireUser } from '@/lib/auth';
import { remainingRecoveryCodes } from '@/lib/totp';
import { changePassword, moveToNewPhone, newBackupCodes } from './actions';

const ERRORS = {
  wrong_password: 'Your current password is not right.',
  mismatch: 'The two new passwords don’t match.',
  weak: 'Use at least 10 characters, mixing letters with numbers or symbols.',
  too_many: 'Too many attempts. Please wait 15 minutes.',
};
const MESSAGES = {
  password_changed: 'Password changed. You’ve been signed out on every other device.',
  recovery_used: 'You signed in with a backup code, which now can’t be used again. If you’ve lost your phone, move 2-step login to your new phone below.',
};

const Current = () => <Field label="Current password" name="current" type="password" autoComplete="current-password" required />;

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { user, memberships } = await requireUser();
  const { error, msg } = await searchParams;
  const err = messageFor(error, ERRORS), note = messageFor(msg, MESSAGES);
  const twoStep = user.totp_enabled || requires2fa(user, memberships);
  const left = user.totp_enabled ? await remainingRecoveryCodes(user.id) : 0;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <PageHeader title="Your account" description={`${user.name} · ${user.email}`} back={{ href: '/', label: 'Back' }} />
      {err && <Notice>{err}</Notice>}
      {note && <Notice kind={msg === 'recovery_used' ? 'warning' : 'success'}>{note}</Notice>}

      <Section title="Password" description="Changing it signs you out on every other device.">
        <form action={changePassword} className="max-w-sm">
          <Current />
          <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={10} required
                 hint="At least 10 characters, with numbers or symbols." />
          <Field label="Repeat new password" name="confirm" type="password" autoComplete="new-password" required />
          <Button><KeyRound className="size-4" /> Change password</Button>
        </form>
      </Section>

      {twoStep && (
        <Section title="2-step login" description="A code from the authenticator app on your phone, asked at every sign-in.">
          {user.totp_enabled ? (
            <div className="space-y-6">
              <p className="flex items-center gap-2 text-sm text-slate-700">
                <ShieldCheck className="size-4 text-emerald-600" /> On.
                <span className={left <= 2 ? 'font-medium text-amber-700' : ''}>{left} of 10 backup codes left.</span>
              </p>
              <form action={newBackupCodes} className="max-w-sm rounded-xl border border-slate-200 p-4">
                <p className="mb-3 text-sm text-slate-600">New backup codes replace the old ones (any you saved stop working).</p>
                <Current />
                <Button variant="secondary">Create new backup codes</Button>
              </form>
              <form action={moveToNewPhone} className="max-w-sm rounded-xl border border-slate-200 p-4">
                <p className="mb-3 text-sm text-slate-600">
                  Got a new phone, or lost the old one? This turns off the old app’s codes and your backup codes,
                  then shows a new QR code to scan.
                </p>
                <Current />
                <Button variant="secondary"><Smartphone className="size-4" /> Move to a new phone</Button>
              </form>
            </div>
          ) : (
            <Notice kind="info">Not set up yet. You’ll be asked to set it up the next time you open the app.</Notice>
          )}
        </Section>
      )}
    </main>
  );
}
