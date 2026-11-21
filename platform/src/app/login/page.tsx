import Link from 'next/link';
import { AuthCard, Button, Field, Notice, messageFor } from '@/components/ui';
import { demoAccounts } from '@/lib/env';
import { demoLogin, login } from './actions';

const ERRORS = {
  invalid: 'Email or password is incorrect.',
  too_many: 'Too many attempts. Please wait 15 minutes and try again.',
  no_demo_user: 'That demo account is not in the database on this computer.',
};
const MESSAGES = { password_set: 'Password saved. Please sign in.', signed_out: 'You have been signed out.' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const { error, msg } = await searchParams;
  const err = messageFor(error, ERRORS), note = messageFor(msg, MESSAGES);
  const demos = demoAccounts();
  return (
    <AuthCard title="Sign in">
      {err && <Notice>{err}</Notice>}
      {note && <Notice kind="success">{note}</Notice>}
      <form action={login}>
        <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <Button className="w-full">Sign in</Button>
      </form>
      <p className="mt-5 text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">Forgot your password?</Link>
      </p>
      {demos.length > 0 && (
        <section className="mt-8 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4">
          <h2 className="text-sm font-semibold text-amber-900">Demo logins</h2>
          <p className="mt-0.5 text-xs text-amber-800">This computer only. One click, no 2-step code. Turned off on the live site.</p>
          <ul className="mt-3 space-y-2">
            {demos.map(d => (
              <li key={d.key}>
                <form action={demoLogin} className="flex items-center gap-3">
                  <input type="hidden" name="account" value={d.key} />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="font-medium text-slate-900">{d.label}</div>
                    <div className="truncate text-slate-600">{d.email} · <span className="font-mono">{d.password}</span></div>
                  </div>
                  <Button variant="secondary" size="sm">Sign in</Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AuthCard>
  );
}
