import type { ReactNode } from 'react';
import Link from 'next/link';
import { AppShell, Notice } from '@/components/ui';
import { audit } from '@/lib/audit';
import { clientInfo } from '@/lib/auth';
import { billingDriver } from '@/lib/env';
import { awaitingDecisionCount } from '@/lib/results';
import { inTenant, loadTenant } from '@/lib/tenant';

export default async function TenantLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await loadTenant(slug);
  if (ctx.readOnlyReason === 'viewing_as') {
    // Recorded in the tenant's own audit log, so they can see when the platform owner looked.
    // One entry per staff member per 30 minutes, not one per page.
    await inTenant(ctx, async tx => {
      const [recent] = await tx`SELECT 1 FROM audit_log WHERE tenant_id = ${ctx.tenant.id} AND actor_user_id = ${ctx.user.id}
                                AND action = 'tenant.viewed_as' AND created_at > now() - interval '30 minutes' LIMIT 1`;
      if (!recent) await audit(tx, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: 'tenant.viewed_as', ip: (await clientInfo()).ip });
    });
  }
  const base = `/t/${slug}`;
  const ROLE: Record<string, string> = { tenant_admin: 'HR admin', recruiter: 'Recruiter', reviewer: 'Reviewer' };
  const admin = ctx.role === 'tenant_admin' || !ctx.role;
  const toReview = await inTenant(ctx, tx => awaitingDecisionCount(tx));
  // Daily work first; set-up and account pages are grouped below so the menu reads top-down by how often it's used.
  const nav = [
    { href: base, label: 'Home', icon: 'dashboard' },
    { href: `${base}/review`, label: 'To review', icon: 'review', badge: toReview },
    { href: `${base}/jobs`, label: 'Jobs & candidates', icon: 'jobs' },
    { href: `${base}/messages`, label: 'Sent messages', icon: 'messages' },
    { href: `${base}/banks`, label: 'Question banks', icon: 'banks', group: 'Interview set-up' },
    ...(admin ? [
      { href: `${base}/consent`, label: 'Consent text', icon: 'consent' },
      { href: `${base}/users`, label: 'Team members', icon: 'users' },
      { href: `${base}/ai`, label: 'AI usage & cost', icon: 'ai', group: 'Account' },
      { href: `${base}/billing`, label: 'Plan & billing', icon: 'billing' },
      { href: `${base}/privacy`, label: 'Privacy requests', icon: 'privacy' },
      { href: `${base}/audit`, label: 'Activity log', icon: 'audit' },
    ] : []),
  ];
  return (
    <AppShell title={ctx.tenant.name} subtitle={ctx.role ? ROLE[ctx.role] : 'Viewing as platform staff'} user={ctx.user} nav={nav}>
      {ctx.readOnlyReason === 'viewing_as' && (
        <Notice kind="info">You are viewing this company as platform staff (read-only). Your visit is recorded in their audit log.</Notice>
      )}
      {ctx.readOnlyReason === 'suspended' && (ctx.tenant.suspended_for_billing ? (
        <Notice>
          This account is paused because the subscription isn’t paid. You can view existing data, but nothing can be changed and no new interviews can start.{' '}
          {ctx.role === 'tenant_admin' ? <Link href={`${base}/billing`} className="font-semibold underline">Go to Billing to pay</Link> : 'Ask your tenant admin to renew it.'}
        </Notice>
      ) : (
        <Notice>This account is suspended. You can view existing data, but nothing can be changed and no new interviews can start. Contact the platform administrator.</Notice>
      ))}
      {ctx.readOnlyReason === 'trial_ended' && (
        <Notice>
          Your trial has ended. Data is read-only until a plan is chosen.{' '}
          {ctx.role === 'tenant_admin' && billingDriver() ? <Link href={`${base}/billing`} className="font-semibold underline">Choose a plan</Link> : 'Contact the platform administrator.'}
        </Notice>
      )}
      {children}
    </AppShell>
  );
}
