import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { inTenant, requireTenant } from '@/lib/tenant';

// The tenant's own audit trail (DPDP Rule 6: logs kept for a year). Includes platform-staff visits.
export default async function TenantAuditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  if (ctx.role && ctx.role !== 'tenant_admin') redirect(`/t/${slug}`);
  const rows = await inTenant(ctx, tx => tx`
    SELECT a.id, a.created_at, a.action, a.ip, u.name AS actor, u.is_super_admin AS staff
    FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.id DESC LIMIT 300`);
  return (
    <>
      <PageHeader title="Activity log" description="Everything that happened in your account: sign-ins, setup changes, invites, decisions, exports and data deletion. Kept for at least one year; it can’t be edited." />
      <Card>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>When</th><th>What</th><th>Who</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap tabular-nums text-slate-500">{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td><span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{r.action}</span></td>
                  <td className="text-slate-700">
                    {r.actor ?? <span className="text-slate-400">Candidate or system</span>}
                    {r.staff && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700">Platform staff</span>}
                  </td>
                  <td className="font-mono text-xs text-slate-400">{r.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
