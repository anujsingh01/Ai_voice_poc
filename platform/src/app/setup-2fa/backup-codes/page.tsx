import { redirect } from 'next/navigation';
import { AuthCard, Button, Notice } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { takeStashedRecoveryCodes } from '@/lib/totp';
import { BackupCodes } from './codes';

export const dynamic = 'force-dynamic';

export default async function BackupCodesPage() {
  const s = await getSession();
  if (!s) redirect('/login');
  if (!s.twoFactorPassed) redirect('/login/verify');
  const codes = await takeStashedRecoveryCodes(s.user.id);
  if (!codes) {
    return (
      <AuthCard title="Backup codes">
        <Notice kind="info">These codes were already shown once. If you didn’t save them, create new ones from your Account page.</Notice>
        <form action="/account" method="get"><Button className="w-full">Go to Account</Button></form>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Save your backup codes"
              subtitle="If you lose your phone, each of these codes lets you sign in once instead of the 6-digit code.">
      <Notice kind="warning">This is the only time you’ll see them. Download or print them now and keep them somewhere safe (not on the same phone).</Notice>
      <BackupCodes codes={codes} email={s.user.email} />
      <form action="/" method="get" className="mt-6"><Button className="w-full">I’ve saved them, continue</Button></form>
    </AuthCard>
  );
}
