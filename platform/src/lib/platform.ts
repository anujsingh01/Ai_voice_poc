import { redirect } from 'next/navigation';
import { requireUser, type User } from './auth';

// Platform staff ("sub-admins") under the owner. Every server action checks one of these permissions;
// pages hide what a role can't do. All staff sign in with 2-step codes and every change is audited.
export type PlatformRole = 'owner' | 'admin' | 'billing' | 'support';

export const PLATFORM_CAN = {
  view: ['owner', 'admin', 'billing', 'support'],      // tenants, plans, usage, audit, workers (read-only)
  manageTenants: ['owner', 'admin'],                   // create tenants, limits, members, suspend
  managePlans: ['owner', 'admin', 'billing'],          // design and edit subscription plans
  assignPlans: ['owner', 'admin', 'billing'],          // move a tenant to another plan; trial / active / suspended
  manageWorkers: ['owner', 'admin'],                   // register and disable transcription PCs
  manageStaff: ['owner'],                              // invite and remove platform staff
} as const satisfies Record<string, readonly PlatformRole[]>;
export type PlatformPermission = keyof typeof PLATFORM_CAN;

export const ROLE_INFO: Record<PlatformRole, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Everything, including platform staff' },
  admin: { label: 'Admin', description: 'Tenants, limits, members, plans and transcription PCs' },
  billing: { label: 'Billing', description: 'Plans, which plan each tenant is on, trial/active/suspended' },
  support: { label: 'Support', description: 'Read-only: tenants (view as), plans, usage, audit log, workers' },
};

export const platformCan = (user: Pick<User, 'is_super_admin' | 'platform_role'>, p: PlatformPermission) =>
  user.is_super_admin && !!user.platform_role && (PLATFORM_CAN[p] as readonly string[]).includes(user.platform_role);

/** Any platform staff member (pages); with a permission, also checks it (actions redirect if missing). */
export async function requirePlatform(permission: PlatformPermission = 'view') {
  const ctx = await requireUser();
  if (!ctx.user.is_super_admin) redirect('/');
  if (!platformCan(ctx.user, permission)) redirect('/super?error=permission');
  return { ...ctx, can: (p: PlatformPermission) => platformCan(ctx.user, p) };
}
