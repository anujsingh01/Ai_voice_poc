import { EyeOff } from 'lucide-react';
import { notFound } from 'next/navigation';
import { buttonClass, controlClass } from '@/components/styles';
import { Notice, PageHeader } from '@/components/ui';
import { languageName } from '@/lib/languages';
import type { Dimension } from '@/lib/rubric';
import { inTenant, requireTenant } from '@/lib/tenant';
import { saveRating } from '../actions';

const GUIDE: Record<string, string> = {
  content: 'Relevant, accurate, complete compared with what a good salesperson would say',
  customer_handling: 'Respectful, listens, handles the concern without arguing',
  persuasion: 'Links benefits to the customer’s need, uses evidence, moves to a close',
  motivation: 'Genuine interest in sales, field work and this job',
  confidence: 'Speaks up, keeps going, few long hesitations',
  fluency: 'Steady pace, few fillers (not accent or grammar)',
};

// Blind rating: transcripts and recordings only. The AI score, flags and evidence are deliberately hidden.
export default async function BlindRatingPage({ params, searchParams }: {
  params: Promise<{ slug: string; id: string; interviewId: string }>; searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const { slug, id, interviewId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(interviewId)) notFound();
  const ctx = await requireTenant(slug, 'manageCandidates');
  const { msg, error } = await searchParams;
  const data = await inTenant(ctx, async tx => {
    const [iv] = await tx`SELECT iv.language, r.dimensions, j.title FROM interviews iv JOIN rubrics r ON r.id = iv.rubric_id JOIN jobs j ON j.id = iv.job_id
                          WHERE iv.id = ${interviewId} AND iv.job_id = ${id} AND iv.status = 'completed'`;
    if (!iv) return null;
    const answers = await tx`
      SELECT iq.position, q.type, q.category, q.texts ->> ${iv.language} AS question, a.id AS answer_id, a.transcript
      FROM interview_questions iq JOIN questions q ON q.id = iq.question_id LEFT JOIN answers a ON a.interview_question_id = iq.id
      WHERE iq.interview_id = ${interviewId} ORDER BY iq.position`;
    const [mine] = await tx`SELECT dimensions, shortlist, notes FROM calibration_ratings WHERE interview_id = ${interviewId} AND rater_id = ${ctx.user.id}`;
    return { iv, answers, mine };
  });
  if (!data) notFound();
  const { iv, answers, mine } = data;
  const dims = iv.dimensions as Dimension[];

  return (
    <>
      <PageHeader title="Score this interview yourself" back={{ href: `/t/${slug}/jobs/${id}/calibration`, label: 'AI accuracy check' }}
                  description={`${iv.title} · ${languageName(iv.language)} · candidate name and AI score hidden so they don’t influence you.`}>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white"><EyeOff className="size-3.5" /> AI score hidden</span>
      </PageHeader>
      {msg === 'saved' && <Notice kind="success">Saved. Here’s the next one.</Notice>}
      {error && <Notice>Give every dimension a score from 1 to 5 and say whether you’d shortlist.</Notice>}
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-4">
          {answers.map(a => (
            <article key={a.position} className="rounded-2xl border border-slate-200/80 bg-white p-5">
              <p className="mb-1 text-xs text-slate-500">{a.position}. {a.type === 'objection' ? 'Customer objection' : 'Question'} · {a.category}</p>
              <p lang={iv.language} className="mb-3 font-medium text-slate-900">{a.question}</p>
              {a.answer_id && <audio controls preload="none" src={`/t/${slug}/answers/${a.answer_id}/audio`} className="mb-3 h-10 w-full" aria-label={`Answer ${a.position}`} />}
              <blockquote lang={iv.language} className="rounded-xl border-l-4 border-slate-300 bg-slate-50 px-4 py-3 text-[15px] leading-relaxed">{a.transcript || <span className="text-slate-400">(no transcript)</span>}</blockquote>
            </article>
          ))}
        </div>
        <form action={saveRating.bind(null, slug, id, interviewId)} className="rounded-2xl border border-slate-200/80 bg-white p-5 xl:sticky xl:top-8">
          <h2 className="mb-1 font-semibold text-slate-900">Your rating</h2>
          <p className="mb-4 text-xs text-slate-500">1 = poor · 3 = average · 5 = excellent. Judge the whole interview.</p>
          <div className="space-y-4">
            {dims.map(d => (
              <fieldset key={d.key}>
                <legend className="text-sm font-medium text-slate-800">{d.label.replace(/ \(.*\)/, '')}</legend>
                <p className="mb-1.5 text-xs text-slate-500">{GUIDE[d.key] ?? ''}</p>
                <div className="grid grid-cols-5 gap-1">
                  {[1, 2, 3, 4, 5].map(v => (
                    <label key={v} className="cursor-pointer">
                      <input type="radio" name={`d_${d.key}`} value={v} required defaultChecked={(mine?.dimensions as Record<string, number>)?.[d.key] === v} className="peer sr-only" />
                      <span className="block rounded-lg border border-slate-200 py-1.5 text-center text-sm font-semibold text-slate-600 transition peer-checked:border-brand-500 peer-checked:bg-brand-600 peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20">{v}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-800">Would you shortlist this candidate?</legend>
              <div className="grid grid-cols-2 gap-2">
                {[['yes', 'Yes'], ['no', 'No']].map(([v, l]) => (
                  <label key={v} className="cursor-pointer">
                    <input type="radio" name="shortlist" value={v} required defaultChecked={mine ? (mine.shortlist ? 'yes' : 'no') === v : false} className="peer sr-only" />
                    <span className="block rounded-lg border border-slate-200 py-2 text-center text-sm font-semibold text-slate-600 peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-700">{l}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <textarea name="notes" rows={2} maxLength={2000} defaultValue={mine?.notes ?? ''} placeholder="Notes (optional)" className={controlClass} />
          </div>
          <button className={`${buttonClass()} mt-4 w-full`}>Save and next</button>
        </form>
      </div>
    </>
  );
}
