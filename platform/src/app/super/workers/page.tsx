import { AlertTriangle, AudioLines, CheckCircle2, Cpu, Hourglass, RotateCcw } from 'lucide-react';
import { linkActionClass } from '@/components/styles';
import { Button, Card, PageHeader, Section, StatCard } from '@/components/ui';
import { withContext } from '@/db';
import { requirePlatform } from '@/lib/platform';
import { retryFailedJobs, setWorkerDisabled } from './actions';
import { NewWorkerForm } from './new-worker-form';

const ago = (d: Date | null) => {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(d).toLocaleString('en-IN');
};

export default async function WorkersPage() {
  const { can } = await requirePlatform();
  const { workers, queue, recent } = await withContext({ superAdmin: true }, async tx => ({
    workers: await tx`
      SELECT w.*, (NOT w.disabled AND w.last_seen_at > now() - interval '2 minutes') AS online,
             (SELECT count(*) FROM transcription_jobs j WHERE j.worker_id = w.id AND j.status = 'done' AND j.finished_at > now() - interval '1 hour')::int AS done_hour
      FROM workers w ORDER BY w.created_at`,
    queue: (await tx`
      SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'leased')::int AS leased,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'queued'))::int AS oldest_queued_s
      FROM transcription_jobs`)[0],
    recent: (await tx`
      SELECT count(*)::int AS n, round(avg(extract(epoch FROM finished_at - created_at)))::int AS avg_s,
             round(percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - created_at)))::int AS p95_s
      FROM transcription_jobs WHERE status = 'done' AND finished_at > now() - interval '24 hours'`)[0],
  }));

  return (
    <>
      <PageHeader title="Transcription" description="Office PCs that turn recorded answers into text with free, open-source speech models. Audio never leaves your machines."
                  actions={queue.failed > 0 && can('manageWorkers') && <form action={retryFailedJobs}><Button variant="secondary"><RotateCcw className="size-4" /> Retry {queue.failed} failed</Button></form>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Waiting" value={queue.queued} sub={queue.oldest_queued_s ? `Oldest waiting ${queue.oldest_queued_s}s` : 'Queue is clear'} icon={<Hourglass className="size-4.5" />} tone="sky" />
        <StatCard label="Being transcribed" value={queue.leased} sub="Right now" icon={<AudioLines className="size-4.5" />} />
        <StatCard label="Done in 24 h" value={recent.n} sub={recent.avg_s != null ? `Avg ${recent.avg_s}s · p95 ${recent.p95_s}s after upload` : 'No answers yet'} icon={<CheckCircle2 className="size-4.5" />} tone="emerald" />
        <StatCard label="Failed" value={queue.failed} sub={queue.failed ? 'Needs attention' : 'All good'} icon={<AlertTriangle className="size-4.5" />} tone={queue.failed ? 'rose' : 'emerald'} />
      </div>
      <Card className="mb-6">
        {workers.length === 0 ? <p className="px-6 py-10 text-center text-sm text-slate-500">No transcription PCs registered yet.</p> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>PC</th><th>Status</th><th>Model</th><th className="text-right">Done (1 h)</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {workers.map(w => {
                  const on = !!w.online;
                  return (
                    <tr key={w.id}>
                      <td><span className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-600"><Cpu className="size-4" /></span><span className="font-medium text-slate-900">{w.name}</span></span></td>
                      <td>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${w.disabled ? 'bg-slate-50 text-slate-600 ring-slate-500/20' : on ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-rose-50 text-rose-700 ring-rose-600/20'}`}>
                          <span className={`size-1.5 rounded-full ${w.disabled ? 'bg-slate-400' : on ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'}`} />
                          {w.disabled ? 'Disabled' : on ? 'Online' : 'Offline'}
                        </span>
                        <p className="mt-1 text-xs text-slate-400">seen {ago(w.last_seen_at)}</p>
                      </td>
                      <td className="text-xs text-slate-600">{[w.info?.model, w.info?.device].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="text-right font-medium tabular-nums">{w.done_hour}</td>
                      <td className="text-right">
                        {can('manageWorkers') && <form action={setWorkerDisabled.bind(null, w.id, !w.disabled)}>
                          <button className={linkActionClass(w.disabled ? 'brand' : 'danger')}>{w.disabled ? 'Enable' : 'Disable'}</button>
                        </form>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {can('manageWorkers') && <Section title="Register a transcription PC" description="Each PC gets its own token. It only makes outbound HTTPS calls to this platform, so no office ports need opening. Disable a PC here to cut it off instantly.">
        <NewWorkerForm appUrl={process.env.APP_URL ?? ''} />
      </Section>}
    </>
  );
}
