import { Ban, CheckCircle2, Clock4, MessageSquare, PenLine } from 'lucide-react';
import { buttonClass, controlClass } from '@/components/styles';
import { Avatar } from '@/components/ui';
import { DECISION_STYLE } from '@/lib/results';
import { addComment, decide, overrideScore } from './actions';

type Decision = { decision: string; reason: string; name: string | null; created_at: Date };
type Override = { ai_score: number | null; new_score: number; reason: string; name: string | null; created_at: Date };
type Comment = { id: number; body: string; position: number | null; name: string | null; created_at: Date };

const when = (d: Date) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const CHOICES = [
  ['shortlist', 'Shortlist', CheckCircle2, 'peer-checked:border-emerald-500 peer-checked:bg-emerald-50 peer-checked:text-emerald-700'],
  ['hold', 'Hold', Clock4, 'peer-checked:border-amber-500 peer-checked:bg-amber-50 peer-checked:text-amber-800'],
  ['reject', 'Reject', Ban, 'peer-checked:border-slate-500 peer-checked:bg-slate-100 peer-checked:text-slate-800'],
] as const;

export function DecisionPanel({ slug, interviewId, decisions, overrides, canDecide, completed }: {
  slug: string; interviewId: string; decisions: Decision[]; overrides: Override[]; canDecide: boolean; completed: boolean;
}) {
  const current = decisions[0];
  return (
    <section id="decide" className="mb-6 rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-semibold text-slate-900">Your decision</h2>
        {current ? (
          <p className="mt-1 text-sm text-slate-600">
            <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${DECISION_STYLE[current.decision][1]}`}>{DECISION_STYLE[current.decision][0]}</span>
            by {current.name ?? 'a removed user'} · {when(current.created_at)}
          </p>
        ) : <p className="mt-1 text-sm text-slate-500">No decision yet. Listen to the answers, then choose below.</p>}
      </div>
      {canDecide && completed && (
        <form action={decide.bind(null, slug, interviewId)} className="border-b border-slate-100 p-5">
          <fieldset className="mb-3 grid grid-cols-3 gap-2">
            <legend className="sr-only">Decision</legend>
            {CHOICES.map(([v, label, Icon, checked]) => (
              <label key={v} className="cursor-pointer">
                <input type="radio" name="decision" value={v} required defaultChecked={current?.decision === v} className="peer sr-only" />
                <span className={`flex flex-col items-center gap-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20 ${checked}`}>
                  <Icon className="size-4" />{label}
                </span>
              </label>
            ))}
          </fieldset>
          <textarea name="reason" required minLength={3} maxLength={2000} rows={2} placeholder="Reason (recorded with your decision)" className={`${controlClass} mb-3`} />
          <button className={`${buttonClass()} w-full`}>Save decision</button>
        </form>
      )}
      {canDecide && completed && (
        <details className="group border-b border-slate-100 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-700"><PenLine className="size-4 text-slate-400" /> Disagree with the AI score? Change it</summary>
          <form action={overrideScore.bind(null, slug, interviewId)} className="mt-3">
            <div className="mb-3 flex items-center gap-2 text-sm text-slate-600">
              New score <input type="number" name="score" min={0} max={100} step={1} required className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-right tabular-nums" /> / 100
            </div>
            <textarea name="reason" required minLength={10} maxLength={2000} rows={2} placeholder="Why the AI score is wrong (at least 10 characters). Used to improve scoring." className={`${controlClass} mb-3`} />
            <button className={`${buttonClass('secondary')} w-full`}>Save new score</button>
          </form>
        </details>
      )}
      {(decisions.length > 1 || overrides.length > 0) && (
        <div className="px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">History</p>
          <ul className="space-y-2 text-xs text-slate-600">
            {[...decisions.map(d => ({ at: d.created_at, text: <><b>{DECISION_STYLE[d.decision][0]}</b> by {d.name ?? '—'}: “{d.reason}”</> })),
              ...overrides.map(o => ({ at: o.created_at, text: <><b>Score {o.ai_score != null ? Number(o.ai_score).toFixed(0) : '—'} → {Number(o.new_score).toFixed(0)}</b> by {o.name ?? '—'}: “{o.reason}”</> }))]
              .sort((a, b) => +new Date(b.at) - +new Date(a.at))
              .map((h, i) => <li key={i}><span className="text-slate-400">{when(h.at)}</span> · {h.text}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

export function Comments({ slug, interviewId, comments, canComment }: { slug: string; interviewId: string; comments: Comment[]; canComment: boolean }) {
  return (
    <section id="comments" className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><MessageSquare className="size-4 text-slate-400" /> Comments <span className="text-sm font-normal text-slate-400">{comments.length}</span></h2>
      {comments.length === 0 && <p className="mb-3 text-sm text-slate-500">No comments yet.</p>}
      <ul className="mb-4 space-y-3">
        {comments.map(c => (
          <li key={c.id} className="flex gap-3">
            <Avatar name={c.name ?? '?'} size="sm" />
            <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <p className="text-xs text-slate-500"><b className="text-slate-700">{c.name ?? 'Removed user'}</b> · {when(c.created_at)}{c.position && ` · answer ${c.position}`}</p>
              <p className="mt-0.5 whitespace-pre-line text-slate-800">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {canComment && (
        <form action={addComment.bind(null, slug, interviewId)} className="space-y-2">
          <textarea name="body" required maxLength={2000} rows={2} placeholder="Add a comment for the hiring team" className={controlClass} />
          <div className="flex items-center gap-2">
            <select name="position" aria-label="About" className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">
              <option value="">Whole interview</option>
              {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>Answer {i + 1}</option>)}
            </select>
            <button className={`${buttonClass('secondary', 'sm')} ml-auto`}>Comment</button>
          </div>
        </form>
      )}
    </section>
  );
}
