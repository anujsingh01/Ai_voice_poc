import { redirect } from 'next/navigation';
import { AuthCard, Button, Field, Notice, messageFor } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { ensurePendingTotpSecret, totpManualKey, totpQrDataUrl } from '@/lib/totp';
import { enable2fa } from '../login/actions';

const ERRORS = {
  invalid: 'That code is not right. Check the time on your phone is automatic, then try the next code.',
  too_many: 'Too many attempts. Please wait 5 minutes.',
};

export default async function Setup2faPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.user.totp_enabled) redirect('/');
  const secret = await ensurePendingTotpSecret(s.user.id);
  if (!secret) redirect('/');
  const err = messageFor((await searchParams).error, ERRORS);
  const qr = await totpQrDataUrl(secret, s.user.email);
  return (
    <AuthCard
      title="Set up 2-step login"
      subtitle="Admin accounts need a code from your phone at every sign-in. This takes a minute."
    >
      {err && <Notice>{err}</Notice>}
      <ol className="text-sm text-slate-700 space-y-3 mb-5 list-decimal pl-5">
        <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator or similar).</li>
        <li>
          Scan this code with the app:
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code for your authenticator app" className="w-44 h-44 mt-2 border rounded" />
          <span className="block text-xs text-slate-500 mt-1">
            Can&apos;t scan? Enter this key: <code className="font-mono">{totpManualKey(secret)}</code>
          </span>
        </li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <form action={enable2fa}>
        <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required />
        <Button className="w-full">Turn on 2-step login</Button>
      </form>
    </AuthCard>
  );
}
