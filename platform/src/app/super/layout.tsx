import type { ReactNode } from 'react';
import { AppShell } from '@/components/ui';
import { ROLE_INFO, requirePlatform } from '@/lib/platform';

export default async function SuperLayout({ children }: { children: ReactNode }) {
  const { user } = await requirePlatform();
  return (
    <AppShell
      title="Platform console"
      subtitle={`${ROLE_INFO[user.platform_role!].label} access`}
      user={user}
      nav={[
        { href: '/super', label: 'Companies', icon: 'tenants' },
        { href: '/super/plans', label: 'Plans', icon: 'plans' },
        { href: '/super/usage', label: 'Usage & costs', icon: 'reports' },
        { href: '/super/workers', label: 'Transcription PCs', icon: 'workers' },
        { href: '/super/staff', label: 'Staff', icon: 'staff' },
        { href: '/super/audit', label: 'Activity log', icon: 'audit' },
      ]}
    >
      {children}
    </AppShell>
  );
}
