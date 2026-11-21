import { notFound, redirect } from 'next/navigation';
import { sql, withContext, type Tx } from '@/db';
import { audit, type AuditEntry } from './audit';
import { clientInfo, requireUser, type Role, type User } from './auth';

export type Tenant = { id: string; slug: string; name: string; status: 'active' | 'trial' | 'suspended'; trial_ends_at: Date | null; suspended_for_billing: boolean };
export type TenantLimits = {
  interviews_per_month: number; concurrent_jobs: number; recruiter_seats: number; languages: string[];
  ai_budget_inr: number; scoring_mode: string; retention_days: number; own_openai_key: boolean;
};

/** What each role may do inside a tenant. Super admins visiting a tenant can only look. */
export const CAN = {
  manageUsers: ['tenant_admin'],
  manageSetup: ['tenant_admin'],                       // jobs, question banks, audio, rubric, consent
  manageCandidates: ['tenant_admin', 'recruiter'],     // import, invite, revoke, decide, override, export
  comment: ['tenant_admin', 'recruiter', 'reviewer'],  // comment on interviews
  view: ['tenant_admin', 'recruiter', 'reviewer'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof CAN;

export type TenantContext = {
  user: User; tenant: Tenant; role: Role | null;   // null = super admin viewing as the tenant
  can: (p: Permission) => boolean;
  readOnly: boolean; readOnlyReason: 'suspended' | 'viewing_as' | 'trial_ended' | null;
};

export async function loadTenant(slug: string): Promise<TenantContext> {
  const { user, memberships } = await requireUser();
  const [tenant] = (await sql`SELECT * FROM tenant_by_slug(${slug})`) as unknown as Tenant[];
  if (!tenant) notFound();
  const m = memberships.find(x => x.tenant_id === tenant.id);
  if (!m && !user.is_super_admin) redirect('/no-access');
  const role = m?.role ?? null;
  const trialEnded = tenant.status === 'trial' && !!tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date();
  const readOnlyReason = tenant.status === 'suspended' ? 'suspended' : trialEnded ? 'trial_ended' : !role ? 'viewing_as' : null;
  return {
    user, tenant, role, readOnlyReason, readOnly: !!readOnlyReason,
    can: p => !readOnlyReason && !!role && (CAN[p] as readonly Role[]).includes(role),
  };
}

/** For pages: loads the tenant and checks the user may at least view it. */
export async function requireTenant(slug: string, permission: Permission = 'view') {
  const ctx = await loadTenant(slug);
  if (permission !== 'view' && !ctx.can(permission)) redirect(`/t/${slug}`);
  return ctx;
}

/** Runs `fn` with the database scoped to this tenant. */
export function inTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) {
  return withContext({ tenantId: ctx.tenant.id }, fn);
}

/**
 * For server actions: requires `permission` (which also rules out suspended tenants and super-admin
 * visits), then runs `fn` in the tenant's database scope with an `audit` helper bound to the actor.
 */
export async function tenantAction<T>(
  slug: string, permission: Exclude<Permission, 'view'>,
  fn: (tx: Tx, ctx: TenantContext, log: (e: Omit<AuditEntry, 'tenantId' | 'actorUserId' | 'ip'>) => Promise<void>) => Promise<T>,
): Promise<T> {
  const ctx = await loadTenant(slug);
  if (!ctx.can(permission)) throw new Error('You do not have permission to do this.');
  const { ip } = await clientInfo();
  return inTenant(ctx, tx => fn(tx, ctx, e => audit(tx, { ...e, tenantId: ctx.tenant.id, actorUserId: ctx.user.id, ip })));
}

export async function tenantLimits(tx: Tx, tenantId: string) {
  const [l] = await tx`SELECT * FROM tenant_limits WHERE tenant_id = ${tenantId}`;
  return l as unknown as TenantLimits;
}

/** Interviews used this calendar month (India time), counted as invitations created. */
export async function invitesThisMonth(tx: Tx) {
  const [r] = await tx`
    SELECT count(*)::int AS n FROM invitations
    WHERE status <> 'revoked'
      AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
  return r.n as number;
}
