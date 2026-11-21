import { CheckCircle2, CircleDashed, ClipboardCheck, Play, XCircle } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonClass } from '@/components/styles';
import { Card, Notice, Section } from '@/components/ui';
import { JobHeader } from '../job-header';
import { jobCalibration, TARGETS } from '@/lib/calibration';
import { inTenant, requireTenant } from '@/lib/tenant';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function Gate({ label, value, target, pass, lowerIsBetter }: { label: string; value: number | null; target: number; pass: boolean; lowerIsBetter?: boolean }) {
  const Icon = value == null ? CircleDashed : pass ? CheckCircle2 : XCircle;
  return (
    <div className={`rounded-2xl border bg-white p-5 ${value == null ? 'border-slate-200' : pass ? 'border-emerald-200' : 'border-rose-200'}`}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className={`size-5 ${value == null ? 'text-slate-300' : pass ? 'text-emerald-500' : 'text-rose-500'}`} />
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{pct(value)}</p>
      <p className="mt-1 text-xs text-slate-500">Target {lowerIsBetter ? 'under' : 'at least'} {pct(target)}</p>
    </div>
  );
}

export default async function CalibrationPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant(slug);
  const { msg } = await searchParams;
  const data = await inTenant(ctx, async tx => {
    const [job] = await tx`SELECT id, title, status, location FROM jobs WHERE id = ${id}`;
    if (!job) return null;
    const [mine] = await tx`
      SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM calibration_ratings cr WHERE cr.interview_id = iv.id AND cr.rater_id = ${ctx.user.id}))::int AS rated,
             count(*)::int AS scored,
             (SELECT iv2.id FROM interviews iv2 WHERE iv2.job_id = ${id} AND iv2.status = 'completed' AND iv2.final_score IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM calibration_ratings cr WHERE cr.interview_id = iv2.id AND cr.rater_id = ${ctx.user.id}) ORDER BY random() LIMIT 1) AS next
      FROM interviews iv WHERE iv.job_id = ${id} AND iv.status = 'completed' AND iv.final_score IS NOT NULL`;
    return { job, mine, report: await jobCalibration(tx, id) };
  });
  if (!data) notFound();
  const { job, mine, report } = data;
  const ready = report.passes.enough && report.passes.withinOne && report.passes.shortlist && report.passes.quotes;

  return (
    <>
      <JobHeader slug={slug} job={job as never} tab="accuracy"
                 description="Is the AI scoring like your best recruiters would? Recruiters score some interviews themselves without seeing the AI’s score, and this page compares the two. Do it before relying on the scores, then once a month."
                 actions={ctx.can('manageCandidates') && mine.next && <Link href={`/t/${slug}/jobs/${id}/calibration/${mine.next}`} className={buttonClass()}><Play className="size-4" /> Score one yourself ({mine.scored - mine.rated} left)</Link>} />
      {msg === 'done' && <Notice kind="success">You’ve rated every scored interview for this job. Thank you.</Notice>}
      <Notice kind={ready ? 'success' : 'info'}>
        {ready ? <><b>The AI is scoring well:</b> every target below is met, across {report.interviews} interviews.</>
               : <>{report.interviews} of {TARGETS.minInterviews} interviews scored by your team so far ({report.raters} {report.raters === 1 ? 'person' : 'people'}). Aim for {TARGETS.minInterviews}–30 interviews, each scored by two recruiters, before trusting the AI’s ranking.</>}
      </Notice>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Gate label="AI score close to your team’s (within 1 point)" value={report.withinOneOverall} target={TARGETS.withinOne} pass={report.passes.withinOne} />
        <Gate label="AI and your team pick the same shortlist" value={report.shortlistAgreement} target={TARGETS.shortlistAgreement} pass={report.passes.shortlist} />
        <Gate label="AI quoted words the candidate didn’t say" value={report.quoteFailureRate} target={TARGETS.quoteFailures} pass={report.passes.quotes} lowerIsBetter />
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-medium text-slate-500">Your recruiters agree with each other</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{pct(report.raterAgreement)}</p>
          <p className="mt-1 text-xs text-slate-500">Within 1 point. The AI can’t be expected to beat this.</p>
        </div>
      </div>
      <Section title="Quality by quality" description="For each quality, how often the AI is within one point of your team, and whether it tends to mark higher (+) or lower (−)." padded={false}>
        {report.perDimension.length === 0 ? <p className="px-6 py-10 text-center text-sm text-slate-500"><ClipboardCheck className="mx-auto mb-2 size-5 text-slate-300" />Nobody has scored an interview yet. Press “Score one yourself” to start.</p> : (
          <Card className="rounded-none border-0 shadow-none">
            <table className="data-table">
              <thead><tr><th>Quality</th><th className="text-right">Scored</th><th>Within 1 point</th><th className="text-right">AI marks</th></tr></thead>
              <tbody>
                {report.perDimension.map(d => (
                  <tr key={d.key}>
                    <td className="font-medium text-slate-800">{d.label}</td>
                    <td className="text-right tabular-nums">{d.pairs}</td>
                    <td className="min-w-48">
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${d.withinOne >= TARGETS.withinOne ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${d.withinOne * 100}%` }} /></div>
                        <span className="w-10 text-right text-sm tabular-nums">{pct(d.withinOne)}</span>
                      </div>
                    </td>
                    <td className={`text-right tabular-nums ${Math.abs(d.meanDiff) >= 0.75 ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>{d.meanDiff >= 0 ? '+' : '−'}{Math.abs(d.meanDiff).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>
    </>
  );
}
