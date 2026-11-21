import { notFound } from 'next/navigation';
import { Clock, FileCheck2, Languages, Phone, ShieldAlert } from 'lucide-react';
import { Avatar, Notice, PageHeader, messageFor } from '@/components/ui';
import { Comments, DecisionPanel } from './decision-panel';

const NOTES = { decided: 'Decision saved.', overridden: 'Score override saved. The AI score is kept for comparison.' };
const ERRORS = { decision: 'Choose shortlist, hold or reject and give a reason.', override: 'Enter a score from 0 to 100 and a reason of at least 10 characters.', not_completed: 'The interview isn’t complete yet.', comment: 'Write a comment (up to 2,000 characters).' };
import { languageName } from '@/lib/languages';
import { inTenant, requireTenant } from '@/lib/tenant';
import { AnswerEvidence, HighlightedTranscript, ScorePanel, type Flag, type StoredAnswer } from './score-panel';

type Metrics = { duration_seconds: number; speech_seconds: number; pause_count: number; long_pauses: number; words: number; words_per_minute: number; filler_count: number };

export default async function InterviewPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant(slug);
  const data = await inTenant(ctx, async tx => {
    const [iv] = await tx`
      SELECT iv.*, c.name AS candidate, c.phone, c.email, j.title AS job, j.id AS job_id, ct.version AS consent_version,
             cr.accepted_at, cr.age_confirmed, r.shortlist_cutoff
      FROM interviews iv JOIN rubrics r ON r.id = iv.rubric_id JOIN candidates c ON c.id = iv.candidate_id JOIN jobs j ON j.id = iv.job_id
      JOIN consent_records cr ON cr.id = iv.consent_record_id JOIN consent_texts ct ON ct.id = cr.consent_text_id
      WHERE iv.id = ${id}`;
    if (!iv) return null;
    const answers = await tx`
      SELECT iq.position, q.code, q.type, q.category, q.knockout, q.knockout_rule, q.texts ->> ${iv.language} AS question,
             a.id AS answer_id, a.attempt, a.duration_ms, a.transcript, a.asr_language, a.asr_confidence, a.low_confidence, a.metrics, a.asr_model,
             tj.status AS job_status, tj.error AS job_error
      FROM interview_questions iq JOIN questions q ON q.id = iq.question_id
      LEFT JOIN answers a ON a.interview_question_id = iq.id
      LEFT JOIN transcription_jobs tj ON tj.answer_id = a.id
      WHERE iq.interview_id = ${id} ORDER BY iq.position`;
    const passes = await tx`SELECT pass, total, model, prompt_version, dimensions, answers, summary, strengths, concerns
                            FROM scores WHERE interview_id = ${id} ORDER BY pass`;
    const decisions = await tx`SELECT d.decision, d.reason, d.created_at, u.name FROM decisions d LEFT JOIN users u ON u.id = d.decided_by
                               WHERE d.interview_id = ${id} ORDER BY d.id DESC`;
    const overrides = await tx`SELECT o.ai_score::float, o.new_score::float, o.reason, o.created_at, u.name FROM score_overrides o LEFT JOIN users u ON u.id = o.overridden_by
                               WHERE o.interview_id = ${id} ORDER BY o.id DESC`;
    const comments = await tx`SELECT c.id, c.body, c.position, c.created_at, u.name FROM comments c LEFT JOIN users u ON u.id = c.author_id
                              WHERE c.interview_id = ${id} ORDER BY c.id`;
    return { iv, answers, passes, decisions, overrides, comments };
  });
  if (!data) notFound();
  const { iv, answers, passes, decisions, overrides, comments } = data;
  const { msg, error } = await searchParams;
  const override = overrides[0] as { new_score: number } | undefined;
  const evidence = new Map(((passes[0]?.answers.answers ?? []) as StoredAnswer[]).map(a => [a.answer_id, a]));
  const pending = answers.filter(a => a.answer_id && !a.transcript && a.job_status !== 'failed').length;
  const flagged = answers.filter(a => a.low_confidence).length;

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3"><Avatar name={iv.candidate} />{iv.candidate}</span>}
                  back={{ href: `/t/${slug}/jobs/${iv.job_id}/results`, label: `${iv.job} · results` }}>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${iv.status === 'completed' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-amber-50 text-amber-800 ring-amber-600/20'}`}>
          {iv.status === 'completed' ? 'Completed' : 'In progress'}
        </span>
      </PageHeader>
      <div className="-mt-4 mb-6 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1.5"><Languages className="size-4 text-slate-400" />{languageName(iv.language)}</span>
        <span className="inline-flex items-center gap-1.5"><Clock className="size-4 text-slate-400" />{new Date(iv.started_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <span className="inline-flex items-center gap-1.5"><FileCheck2 className="size-4 text-slate-400" />Consent v{iv.consent_version}{iv.age_confirmed && ' · 18+ confirmed'}</span>
        {iv.phone && <span className="inline-flex items-center gap-1.5"><Phone className="size-4 text-slate-400" />{iv.phone}</span>}
      </div>
      {messageFor(msg, NOTES) && <Notice kind="success">{messageFor(msg, NOTES)}</Notice>}
      {messageFor(error, ERRORS) && <Notice>{messageFor(error, ERRORS)}</Notice>}
      {pending > 0 && <Notice kind="info">{pending} answer{pending === 1 ? ' is' : 's are'} still being transcribed. Reload in a minute.</Notice>}
      {flagged > 0 && <Notice>{flagged} answer{flagged === 1 ? ' was' : 's were'} hard to hear or very short, so the written text may be wrong. Play the recording before judging; this is never a reason to reject on its own.</Notice>}

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="order-2 min-w-0 space-y-4 xl:order-1">
          {answers.map(a => {
            const m = a.metrics as Metrics | null;
            const ev = evidence.get(`A${a.position}`);
            return (
              <article key={a.position} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-slate-900 text-xs font-semibold text-white">{a.position}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${a.type === 'objection' ? 'bg-amber-50 text-amber-800 ring-amber-600/20' : 'bg-brand-50 text-brand-700 ring-brand-600/20'}`}>{a.type === 'objection' ? 'Customer objection role-play' : 'Question'}</span>
                  <span className="text-xs text-slate-500">{a.category}</span>
                  {a.knockout && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20" title={a.knockout_rule}><ShieldAlert className="size-3" /> Must-pass</span>}
                </div>
                <p lang={iv.language} className="mb-4 font-medium leading-relaxed text-slate-900">{a.question}</p>
                {!a.answer_id ? <p className="text-sm text-slate-500">Not answered yet.</p> : (
                  <>
                    <audio controls preload="none" src={`/t/${slug}/answers/${a.answer_id}/audio`} className="mb-3 h-10 w-full" aria-label={`Answer ${a.position}`} />
                    {a.transcript != null ? (
                      <blockquote lang={a.asr_language ?? iv.language} className={`rounded-xl border-l-4 px-4 py-3 text-[15px] leading-relaxed ${a.low_confidence ? 'border-amber-400 bg-amber-50' : 'border-brand-300 bg-slate-50'}`}>
                        {a.transcript ? <HighlightedTranscript text={a.transcript} quotes={ev ? Object.values(ev.dimensions).map(d => d.quote) : []} />
                                      : <span className="text-slate-500">(no speech detected)</span>}
                      </blockquote>
                    ) : a.job_status === 'failed' ? (
                      <p className="text-sm text-rose-700">Transcription failed: {a.job_error}</p>
                    ) : <p className="text-sm text-slate-500">Transcribing…</p>}
                    <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                      {[
                        `${(a.duration_ms / 1000).toFixed(0)}s recorded${a.attempt === 2 ? ' · re-recorded' : ''}`,
                        ...(m ? [`${m.speech_seconds.toFixed(0)}s speaking`, `${m.words_per_minute.toFixed(0)} words/min`, `${m.pause_count} pauses${m.long_pauses ? ` (${m.long_pauses} long)` : ''}`, `${m.filler_count} fillers`] : []),
                      ].map(t => <span key={t} className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-600">{t}</span>)}
                      {a.asr_language && a.asr_language !== iv.language && <span className="rounded-md bg-sky-50 px-2 py-0.5 font-medium text-sky-700">answered in {languageName(a.asr_language)}</span>}
                      {a.asr_confidence != null && <span className={`rounded-md px-2 py-0.5 ${a.low_confidence ? 'bg-amber-100 font-medium text-amber-800' : 'bg-slate-100 text-slate-600'}`}>speech-to-text {Math.round(a.asr_confidence * 100)}% sure</span>}
                    </div>
                    {ev && <AnswerEvidence a={ev} />}
                  </>
                )}
              </article>
            );
          })}
        </div>
        <aside className="order-1 xl:order-2">
          {iv.status === 'completed' ? (
            <>
              {override && (
                <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
                  Recruiter score <b className="text-lg tabular-nums">{Math.round(override.new_score)}</b> replaces the AI score below.
                </div>
              )}
              <ScorePanel part="summary" status={iv.score_status} finalScore={iv.final_score} cutoff={iv.shortlist_cutoff} flags={iv.score_flags as Flag[]} passes={passes as never} />
            </>
          ) : (
            <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-5 text-sm text-slate-600">
              The score appears here once the candidate finishes and every answer is transcribed.
              <p className="mt-2 font-medium text-slate-800">{answers.filter(a => a.answer_id).length} of {answers.length} answered</p>
            </div>
          )}
          <DecisionPanel slug={slug} interviewId={id} decisions={decisions as never} overrides={overrides as never}
                         canDecide={ctx.can('manageCandidates')} completed={iv.status === 'completed'} />
          {iv.status === 'completed' && <ScorePanel part="breakdown" status={iv.score_status} finalScore={iv.final_score} cutoff={iv.shortlist_cutoff} flags={iv.score_flags as Flag[]} passes={passes as never} />}
          <Comments slug={slug} interviewId={id} comments={comments as never} canComment={ctx.can('comment')} />
        </aside>
      </div>
    </>
  );
}
