import { Building2, IndianRupee, Mic, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Avatar, Card, EmptyState, LinkAsButton, Notice, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { withContext } from '@/db';
import { healthReport } from '@/lib/health';
import { requirePlatform } from '@/lib/platform';

// Start of the current month in India time (a constant SQL fragment, never user input).
const MONTH = "date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'";
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: n < 100 ? 2 : 0 });

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { can } = await requirePlatform();
  const { error } = await searchParams;
  const health = await healthReport();
  const { tenants, kpi } = await withContext({ superAdmin: true }, async tx => ({
    tenants: await tx.unsafe(`
      SELECT t.id, t.name, t.slug, t.status, t.trial_ends_at, p.name AS plan, l.custom, l.interviews_per_month, l.recruiter_seats,
             (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id)::int AS members,
             (SELECT count(*) FROM invitations i WHERE i.tenant_id = t.id AND i.status <> 'revoked' AND i.created_at >= ${MONTH})::int AS used,
             (SELECT count(*) FROM interviews iv WHERE iv.tenant_id = t.id AND iv.status = 'completed')::int AS completed
      FROM tenants t JOIN tenant_limits l ON l.tenant_id = t.id LEFT JOIN plans p ON p.id = t.plan_id
      ORDER BY t.created_at DESC`),
    kpi: (await tx.unsafe(`
      SELECT (SELECT count(*) FROM tenants)::int AS tenants,
             (SELECT count(*) FROM tenants WHERE status = 'trial')::int AS trials,
             (SELECT coalesce(sum(CASE p.billing_period WHEN 'monthly' THEN p.price_inr ELSE p.price_inr / 12.0 END), 0)
                FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE t.status = 'active')::float AS mrr,
             (SELECT count(*) FROM interviews WHERE started_at >= ${MONTH})::int AS interviews,
             (SELECT count(*) FROM interviews WHERE status = 'completed' AND completed_at >= ${MONTH})::int AS completed,
             (SELECT coalesce(sum(cost_inr), 0) FROM usage_ledger WHERE billed_to = 'platform' AND created_at >= ${MONTH})::float AS ai`))[0],
  }));

  return (
    <>
      <PageHeader
        title="Companies"
        description="Every company on the platform, its plan and how much of it they’re using this month."
        actions={can('manageTenants') && <LinkAsButton href="/super/tenants/new"><Plus className="size-4" /> New company</LinkAsButton>}
      />
      {error === 'permission' && <Notice>Your platform role doesn’t allow that action.</Notice>}
      {health.alarms.map(a => <Notice key={a.code} kind={a.level === 'critical' ? 'error' : 'warning'}><b>{a.level === 'critical' ? 'Critical' : 'Warning'}:</b> {a.message}</Notice>)}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Companies" value={kpi.tenants} sub={`${kpi.trials} on free trial`} icon={<Building2 className="size-4.5" />} />
        <StatCard label="Monthly recurring revenue" value={inr(kpi.mrr)} sub="Active companies at list price" icon={<IndianRupee className="size-4.5" />} tone="emerald" />
        <StatCard label="Interviews this month" value={kpi.interviews.toLocaleString('en-IN')} sub={`${kpi.completed} completed`} icon={<Mic className="size-4.5" />} tone="sky" />
        <StatCard label="AI spend this month" value={inr(kpi.ai)} sub="Platform-billed scoring" icon={<Sparkles className="size-4.5" />} tone="amber" />
      </div>

      {tenants.length === 0 ? <EmptyState icon={<Building2 className="size-5" />}>No companies yet. Create the first company to get started.</EmptyState> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Company</th><th>Status</th><th>Plan</th><th>Interviews this month</th><th className="text-right">Completed</th><th className="text-right">Members</th></tr>
              </thead>
              <tbody>
                {tenants.map(t => {
                  const pct = t.interviews_per_month ? t.used / t.interviews_per_month : 0;
                  return (
                    <tr key={t.id}>
                      <td>
                        <Link href={`/super/tenants/${t.id}`} className="flex items-center gap-3">
                          <Avatar name={t.name} size="sm" />
                          <span>
                            <span className="block font-medium text-slate-900 hover:text-brand-700">{t.name}</span>
                            <span className="block text-xs text-slate-500">/t/{t.slug}</span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={t.status} />
                        {t.status === 'trial' && t.trial_ends_at && <span className="mt-1 block text-xs text-slate-500">ends {new Date(t.trial_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                      </td>
                      <td>
                        {t.plan ? <span className="inline-flex rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-600/15">{t.plan}</span>
                                : <span className="text-xs text-slate-400">No plan</span>}
                        {t.custom && <span className="ml-1.5 text-xs text-amber-700">custom</span>}
                      </td>
                      <td className="min-w-48">
                        <div className="flex items-center justify-between text-xs text-slate-600">
                          <span className="tabular-nums">{t.used.toLocaleString('en-IN')} / {t.interviews_per_month.toLocaleString('en-IN')}</span>
                          <span className="tabular-nums text-slate-400">{Math.round(pct * 100)}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${pct >= 1 ? 'bg-rose-500' : pct >= 0.8 ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${Math.max(2, Math.min(100, pct * 100))}%` }} />
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{t.completed}</td>
                      <td className="text-right tabular-nums">{t.members}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
