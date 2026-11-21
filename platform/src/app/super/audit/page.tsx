import { ScrollText } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui';
import { withContext } from '@/db';
import { requirePlatform } from '@/lib/platform';

// Colour by the area of the event ("auth.login" → auth).
const AREA: Record<string, string> = {
  auth: 'bg-sky-50 text-sky-700 ring-sky-600/20', tenant: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  plan: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', staff: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  interview: 'bg-amber-50 text-amber-800 ring-amber-600/20',
};

export default async function AuditPage() {
  await requirePlatform();
  const rows = await withContext({ superAdmin: true }, tx => tx`
    SELECT a.id, a.created_at, a.action, a.target, a.ip, u.email AS actor, t.name AS tenant
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN tenants t ON t.id = a.tenant_id
    ORDER BY a.id DESC LIMIT 200`);
  return (
    <>
      <PageHeader title="Audit log" description="Latest 200 events across the platform. Entries are kept for at least one year and can’t be edited or deleted." />
      <Card>
        {rows.length === 0 ? <p className="flex flex-col items-center gap-2 px-6 py-12 text-sm text-slate-500"><ScrollText className="size-5 text-slate-300" />No events yet.</p> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>When</th><th>Event</th><th>Company</th><th>Target</th><th>By</th><th>IP</th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const area = String(r.action).split('.')[0];
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap tabular-nums text-slate-500">{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })}</td>
                      <td><span className={`inline-flex rounded-md px-2 py-0.5 font-mono text-xs ring-1 ring-inset ${AREA[area] ?? 'bg-slate-50 text-slate-700 ring-slate-500/20'}`}>{r.action}</span></td>
                      <td className="text-slate-700">{r.tenant ?? <span className="text-slate-300">—</span>}</td>
                      <td className="max-w-48 truncate text-xs text-slate-500" title={r.target ?? ''}>{r.target ?? ''}</td>
                      <td className="text-slate-700">{r.actor ?? <span className="text-slate-400">system</span>}</td>
                      <td className="font-mono text-xs text-slate-400">{r.ip ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
