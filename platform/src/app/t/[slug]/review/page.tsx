import { AlertTriangle, ArrowRight, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { Avatar, Card, EmptyState, PageHeader } from '@/components/ui';
import { languageName } from '@/lib/languages';
import { awaitingDecision, FLAG_LABEL } from '@/lib/results';
import { inTenant, requireTenant } from '@/lib/tenant';

export default async function ReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const rows = await inTenant(ctx, tx => awaitingDecision(tx));
  const flagged = rows.filter(r => r.score_status === 'needs_review').length;
  const decide = ctx.can('manageCandidates');

  return (
    <>
      <PageHeader title="To review"
                  description={decide
                    ? 'Finished interviews from every job that still need your decision. Open one, listen to the answers, then shortlist, hold or reject.'
                    : 'Finished interviews from every job that nobody has decided on yet. Open one to listen and leave a comment for the recruiter.'} />
      {rows.length === 0 ? <EmptyState icon={<ClipboardCheck className="size-5" />}>Nothing waiting. New interviews appear here a few minutes after a candidate finishes.</EmptyState> : (
        <>
          {flagged > 0 && (
            <p className="mb-4 flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle className="size-4 text-amber-500" />
              {flagged} {flagged === 1 ? 'interview is' : 'interviews are'} flagged and listed first. A flag means “check this yourself”, never “reject”.
            </p>
          )}
          <Card>
            <ul className="divide-y divide-slate-100">
              {rows.map(r => {
                const above = r.score >= r.shortlist_cutoff;
                return (
                  <li key={r.id}>
                    <Link href={`/t/${slug}/interviews/${r.id}`} className="group flex flex-wrap items-center gap-x-5 gap-y-2 px-6 py-4 hover:bg-slate-50/70">
                      <Avatar name={r.name} size="sm" />
                      <div className="min-w-48 flex-1">
                        <p className="font-medium text-slate-900 group-hover:text-brand-700">{r.name}</p>
                        <p className="text-xs text-slate-500">{r.job} · {languageName(r.language)} · {new Date(r.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                        {r.flags.length > 0 && (
                          <p className="mt-1 flex flex-wrap gap-1.5">
                            {[...new Set(r.flags.map(f => f.type))].map(t => (
                              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
                                <AlertTriangle className="size-3" />{FLAG_LABEL[t] ?? t}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`text-xl font-semibold tabular-nums ${above ? 'text-emerald-700' : 'text-slate-900'}`}>{Math.round(r.score)}</p>
                        <p className="text-xs text-slate-500">{above ? 'above' : 'below'} cut-off {r.shortlist_cutoff}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-700">{decide ? 'Review' : 'Open'} <ArrowRight className="size-3.5" /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
