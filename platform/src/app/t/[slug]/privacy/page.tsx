import { Download, Lock, Trash2 } from 'lucide-react';
import { buttonClass, controlClass, linkActionClass } from '@/components/styles';
import { Card, EmptyState, Notice, PageHeader, StatCard, messageFor } from '@/components/ui';
import { inTenant, requireTenant } from '@/lib/tenant';
import { closeRequest, deleteForRequest } from './actions';

const KIND: Record<string, [string, string]> = {
  access: ['Copy of data', 'bg-sky-50 text-sky-700 ring-sky-600/20'], correction: ['Correction', 'bg-brand-50 text-brand-700 ring-brand-600/20'],
  deletion: ['Deletion', 'bg-rose-50 text-rose-700 ring-rose-600/20'], withdraw: ['Consent withdrawn', 'bg-slate-100 text-slate-700 ring-slate-500/20'],
  complaint: ['Complaint', 'bg-amber-50 text-amber-800 ring-amber-600/20'],
};
const MESSAGES = { closed: 'Request closed.', deleted: 'The candidate’s data was deleted and the request closed.' };
const ERRORS = { resolution: 'Describe how the request was resolved.' };

export default async function PrivacyRequestsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const { msg, error } = await searchParams;
  const { requests, deletions } = await inTenant(ctx, async tx => ({
    requests: await tx`SELECT r.*, u.name AS handler FROM rights_requests r LEFT JOIN users u ON u.id = r.handled_by
                       ORDER BY (r.status = 'closed'), r.due_at LIMIT 300`,
    deletions: (await tx`SELECT coalesce(sum(candidates), 0)::int AS candidates, coalesce(sum(files), 0)::int AS files FROM deletion_log`)[0],
  }));
  const open = requests.filter(r => r.status !== 'closed');
  const overdue = open.filter(r => new Date(r.due_at) < new Date()).length;
  const edit = ctx.can('manageSetup');

  return (
    <>
      <PageHeader title="Privacy requests" description="Candidates’ requests under the DPDP Act: copies of data, corrections, deletion, complaints and withdrawn consent. Respond within 30 days." />
      {messageFor(msg, MESSAGES) && <Notice kind="success">{messageFor(msg, MESSAGES)}</Notice>}
      {messageFor(error, ERRORS) && <Notice>{messageFor(error, ERRORS)}</Notice>}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Open requests" value={open.length} tone={open.length ? 'amber' : 'emerald'} icon={<Lock className="size-4.5" />} sub={overdue ? `${overdue} overdue` : 'None overdue'} />
        <StatCard label="Candidates deleted" value={deletions.candidates} tone="sky" icon={<Trash2 className="size-4.5" />} sub="Retention, withdrawals and requests" />
        <StatCard label="Recordings deleted" value={deletions.files} tone="sky" icon={<Trash2 className="size-4.5" />} sub="Audio files removed from storage" />
      </div>
      {requests.length === 0 ? <EmptyState icon={<Lock className="size-5" />}>No requests yet. Candidates make them from the privacy link in every message.</EmptyState> : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {requests.map(r => {
              const late = r.status !== 'closed' && new Date(r.due_at) < new Date();
              return (
                <li key={r.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${KIND[r.kind][1]}`}>{KIND[r.kind][0]}</span>
                    <span className="font-medium text-slate-900">{r.candidate_ref}</span>
                    <span className="text-xs text-slate-500">received {new Date(r.created_at).toLocaleDateString('en-IN')}</span>
                    {r.status === 'closed'
                      ? <span className="ml-auto text-xs font-medium text-emerald-700">Closed {r.closed_at && new Date(r.closed_at).toLocaleDateString('en-IN')}{r.handler && ` by ${r.handler}`}</span>
                      : <span className={`ml-auto text-xs font-medium ${late ? 'text-rose-700' : 'text-amber-700'}`}>{late ? 'Overdue' : 'Due'} {new Date(r.due_at).toLocaleDateString('en-IN')}</span>}
                  </div>
                  {r.details && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{r.details}</p>}
                  {r.resolution && <p className="mt-2 text-sm text-slate-600"><b>Resolution:</b> {r.resolution}</p>}
                  {edit && r.status !== 'closed' && (
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      {r.kind === 'access' && r.candidate_id && <a href={`/t/${slug}/privacy/${r.id}/export`} className={linkActionClass()}><Download className="size-3.5" /> Download their data</a>}
                      {r.kind === 'deletion' && r.candidate_id && (
                        <form action={deleteForRequest.bind(null, slug, r.id)}><button className={buttonClass('danger', 'sm')}><Trash2 className="size-3.5" /> Delete their data now</button></form>
                      )}
                      <form action={closeRequest.bind(null, slug, r.id)} className="flex min-w-72 flex-1 gap-2">
                        <input name="resolution" required minLength={3} placeholder="How it was resolved" className={`${controlClass} h-8 text-xs`} />
                        <button className={buttonClass('secondary', 'sm')}>Close</button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
