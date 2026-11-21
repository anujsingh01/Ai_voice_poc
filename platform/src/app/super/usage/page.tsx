import { IndianRupee, Mic, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { Avatar, Card, PageHeader, StatCard } from '@/components/ui';
import { withContext } from '@/db';
import { requirePlatform } from '@/lib/platform';

// Constant SQL fragment: start of the current month, India time.
const MONTH = "date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'";
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: n < 100 ? 2 : 0 });

export default async function UsagePage() {
  await requirePlatform();
  const rows = await withContext({ superAdmin: true }, tx => tx.unsafe(`
    SELECT t.id, t.name, t.status, p.name AS plan,
           coalesce(CASE p.billing_period WHEN 'monthly' THEN p.price_inr ELSE p.price_inr / 12.0 END, 0)::float AS revenue,
           l.interviews_per_month, l.ai_budget_inr,
           (SELECT count(*) FROM interviews iv WHERE iv.tenant_id = t.id AND iv.completed_at >= ${MONTH})::int AS interviews,
           (SELECT coalesce(sum(u.cost_inr), 0) FROM usage_ledger u WHERE u.tenant_id = t.id AND u.billed_to = 'platform' AND u.created_at >= ${MONTH})::float AS ai,
           (SELECT coalesce(sum(u.cost_inr), 0) FROM usage_ledger u WHERE u.tenant_id = t.id AND u.billed_to = 'tenant' AND u.created_at >= ${MONTH})::float AS own_ai
    FROM tenants t JOIN tenant_limits l ON l.tenant_id = t.id LEFT JOIN plans p ON p.id = t.plan_id
    ORDER BY ai DESC, t.name`));
  const total = rows.reduce((s, r) => ({ revenue: s.revenue + (r.status === 'active' ? r.revenue : 0), ai: s.ai + r.ai, interviews: s.interviews + r.interviews }), { revenue: 0, ai: 0, interviews: 0 });

  return (
    <>
      <PageHeader title="Usage and costs" description="This month, per company. Revenue is list price for active companies; AI cost is what the platform paid for scoring (tenants on their own key are billed directly). Speech-to-text costs nothing per use." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue (list price)" value={inr(total.revenue)} icon={<IndianRupee className="size-4.5" />} tone="emerald" sub="Active companies" />
        <StatCard label="AI scoring cost" value={inr(total.ai)} icon={<Sparkles className="size-4.5" />} tone="amber" sub="Platform-billed" />
        <StatCard label="Interviews completed" value={total.interviews.toLocaleString('en-IN')} icon={<Mic className="size-4.5" />} tone="sky" sub={total.interviews ? `${inr(total.ai / total.interviews)} AI cost each` : 'None yet'} />
        <StatCard label="Gross margin on AI" value={total.revenue ? `${Math.round(100 * (1 - total.ai / total.revenue))}%` : '—'} icon={<TrendingUp className="size-4.5" />} sub="Before hosting costs" />
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Company</th><th>Plan</th><th className="text-right">Interviews</th><th>AI budget used</th><th className="text-right">AI cost</th><th className="text-right">Per interview</th><th className="text-right">Revenue</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const used = r.ai_budget_inr ? r.ai / r.ai_budget_inr : 0;
                return (
                  <tr key={r.id}>
                    <td><Link href={`/super/tenants/${r.id}`} className="flex items-center gap-3"><Avatar name={r.name} size="sm" /><span className="font-medium text-slate-900 hover:text-brand-700">{r.name}</span></Link></td>
                    <td className="text-slate-600">{r.plan ?? '—'}</td>
                    <td className="text-right tabular-nums">{r.interviews} <span className="text-slate-400">/ {r.interviews_per_month.toLocaleString('en-IN')}</span></td>
                    <td className="min-w-40">
                      <div className="flex justify-between text-xs text-slate-500"><span>{inr(r.ai)} / {inr(r.ai_budget_inr)}</span><span>{Math.round(used * 100)}%</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${used >= 1 ? 'bg-rose-500' : used >= 0.9 ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${Math.max(2, Math.min(100, used * 100))}%` }} /></div>
                    </td>
                    <td className="text-right tabular-nums">{inr(r.ai)}{r.own_ai > 0 && <span className="block text-xs text-slate-400">+ {inr(r.own_ai)} own key</span>}</td>
                    <td className="text-right tabular-nums">{r.interviews ? inr((r.ai + r.own_ai) / r.interviews) : '—'}</td>
                    <td className="text-right tabular-nums font-medium">{r.status === 'active' ? inr(r.revenue) : <span className="text-xs font-normal text-slate-400">{r.status}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
