import { AlertTriangle, Check, Gauge, Sparkles } from 'lucide-react';
import { FLAG_LABEL } from '@/lib/results';
import { DEFAULT_DIMENSIONS } from '@/lib/rubric';

// Stored JSON loses key order; show dimensions in the rubric's order.
const ORDER = DEFAULT_DIMENSIONS.map(d => d.key);
const ordered = <T,>(o: Record<string, T>) => Object.entries(o).sort(([a], [b]) => (ORDER.indexOf(a) + 99) % 99 - (ORDER.indexOf(b) + 99) % 99);

export type StoredDimension = { score: number | null; weight: number; source: 'ai' | 'measured'; label: string };
export type StoredAnswer = {
  answer_id: string; code: string;
  dimensions: Record<string, { score: number | null; quote: string; reason: string; quote_verified: boolean }>;
  knockout: { rule: string; passed: boolean | null; quote: string } | null;
  must_mention: { required: string[]; covered: string[] };
  measured: { confidence: number; fluency: number } | null;
};
export type Flag = { type: string; detail: string; answer?: string };

const STATUS: Record<string, [string, string]> = {
  waiting: ['Waiting for transcripts', 'bg-slate-100 text-slate-700'],
  queued: ['Queued for scoring', 'bg-brand-50 text-brand-700'],
  scoring: ['Scoring…', 'bg-brand-50 text-brand-700'],
  scored: ['Scored', 'bg-emerald-50 text-emerald-700'],
  needs_review: ['Flagged: please check', 'bg-amber-50 text-amber-800'],
  paused_budget: ['Paused: AI budget used up', 'bg-rose-50 text-rose-700'],
  failed: ['Scoring failed', 'bg-rose-50 text-rose-700'],
};

const LABEL = Object.fromEntries(DEFAULT_DIMENSIONS.map(d => [d.key, d.label]));

/** Ring gauge for the 0–100 score, with a tick at the shortlist cut-off. */
function ScoreRing({ score, cutoff }: { score: number; cutoff: number }) {
  const r = 52, c = 2 * Math.PI * r;
  const pass = score >= cutoff;
  const tick = (cutoff / 100) * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 128 128" className="size-32" role="img" aria-label={`Score ${Math.round(score)} out of 100, cut-off ${cutoff}`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="#eef0f4" strokeWidth="11" />
      <circle cx="64" cy="64" r={r} fill="none" stroke={pass ? '#10b981' : '#6c63ea'} strokeWidth="11" strokeLinecap="round"
              strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 64 64)" />
      <line x1={64 + 44 * Math.cos(tick)} y1={64 + 44 * Math.sin(tick)} x2={64 + 60 * Math.cos(tick)} y2={64 + 60 * Math.sin(tick)} stroke="#0f172a" strokeWidth="2" />
      <text x="64" y="70" textAnchor="middle" fontSize="34" fontWeight="600" fill="#0f172a">{Math.round(score)}</text>
      <text x="64" y="88" textAnchor="middle" fontSize="11" fontWeight="500" fill="#94a3b8">out of 100</text>
    </svg>
  );
}

/** `part` lets the page put the decision box between the headline score and the full breakdown. */
export function ScorePanel({ status, finalScore, cutoff, flags, passes, part }: {
  part: 'summary' | 'breakdown'; status: string; finalScore: number | null; cutoff: number; flags: Flag[];
  passes: { pass: number; total: number; model: string; prompt_version: string; dimensions: Record<string, StoredDimension>; summary: string; strengths: string[]; concerns: string[] }[];
}) {
  const [label, style] = STATUS[status] ?? [status, 'bg-slate-100'];
  const p1 = passes[0];
  const box = 'mb-6 rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]';
  if (part === 'breakdown') return p1 ? (
    <section className={box}>
      <h2 className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">How the score was worked out</h2>
      <Breakdown p1={p1} passes={passes} />
    </section>
  ) : null;
  return (
    <section className={box}>
      <div className="flex items-center gap-5 p-5">
        {finalScore != null ? <ScoreRing score={Number(finalScore)} cutoff={cutoff} /> : <div className="grid size-32 place-items-center rounded-full bg-slate-50 text-xs text-slate-400">No score yet</div>}
        <div className="min-w-0">
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{label}</span>
          {finalScore != null && (
            <p className="mt-2 text-sm text-slate-600">
              {Number(finalScore) >= cutoff ? <span className="font-semibold text-emerald-700">Above</span> : <span className="font-semibold text-slate-800">Below</span>} the shortlist cut-off of {cutoff}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-400">The AI suggests. A person decides.</p>
        </div>
      </div>
      {flags.length > 0 && (
        <ul className="space-y-2 border-t border-slate-100 p-5">
          {flags.map((f, i) => (
            <li key={i} className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <span><b>{FLAG_LABEL[f.type] ?? f.type}{f.answer && ` · answer ${f.answer.replace(/^A/, '')}`}:</b> {f.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Pass = Parameters<typeof ScorePanel>[0]['passes'][number];

function Breakdown({ p1, passes }: { p1: Pass; passes: Pass[] }) {
  return (
    <div className="p-5">
      <ul className="space-y-3">
        {ordered(p1.dimensions).map(([key, d]) => {
          const second = passes[1]?.dimensions[key]?.score;
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="flex items-center gap-1.5 text-slate-700">
                  {d.source === 'ai' ? <Sparkles className="size-3.5 text-brand-500" /> : <Gauge className="size-3.5 text-sky-500" />}{d.label}
                  <span className="text-xs text-slate-400">{d.weight}%</span>
                </span>
                <span className="font-semibold tabular-nums text-slate-900">{d.score != null ? d.score.toFixed(1) : 'n/a'}<span className="font-normal text-slate-400">/5</span></span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                {d.score != null && <div className={`h-full rounded-full ${d.source === 'ai' ? 'bg-brand-500' : 'bg-sky-500'}`} style={{ width: `${((d.score - 1) / 4) * 100}%` }} />}
              </div>
              {second != null && Math.abs(second - (d.score ?? second)) >= 0.5 && <p className="mt-0.5 text-right text-xs text-amber-700">a second AI check gave {second.toFixed(1)}</p>}
            </li>
          );
        })}
      </ul>
      <p className="mt-5 text-sm leading-relaxed text-slate-700">{p1.summary}</p>
      {p1.strengths.length > 0 && <div className="mt-4"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Strengths</p><ul className="space-y-1 text-sm text-slate-700">{p1.strengths.map(s => <li key={s} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />{s}</li>)}</ul></div>}
      {p1.concerns.length > 0 && <div className="mt-4"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">Concerns</p><ul className="space-y-1 text-sm text-slate-700">{p1.concerns.map(s => <li key={s} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />{s}</li>)}</ul></div>}
      <details className="mt-5 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
        <summary className="cursor-pointer">Technical details</summary>
        <p className="mt-1">{passes.map(p => `Check ${p.pass}: ${Number(p.total).toFixed(1)} · ${p.model} · ${p.prompt_version}`).join('  |  ')}</p>
      </details>
    </div>
  );
}

/** Highlights the AI's supporting quotes inside the transcript (case-insensitive, exact text). */
export function HighlightedTranscript({ text, quotes }: { text: string; quotes: string[] }) {
  const ranges: [number, number][] = [];
  const lower = text.toLowerCase();
  for (const q of quotes.filter(Boolean)) {
    const i = lower.indexOf(q.toLowerCase().trim());
    if (i >= 0) ranges.push([i, i + q.trim().length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s < at) continue;
    parts.push(text.slice(at, s), <mark key={s} className="rounded bg-amber-100/80 px-0.5 text-inherit">{text.slice(s, e)}</mark>);
    at = e;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export function AnswerEvidence({ a }: { a: StoredAnswer }) {
  return (
    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-sm">
      <div className="flex flex-wrap gap-2 mb-2">
        {ordered(a.dimensions).map(([k, d]) => (
          <span key={k} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200" title={d.reason}>
            {LABEL[k] ?? k}: <b>{d.score ?? 'n/a'}</b>{d.score != null && !d.quote_verified && ' ⚠'}
          </span>
        ))}
        {a.measured && <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">confidence {a.measured.confidence} · fluency {a.measured.fluency}</span>}
      </div>
      <ul className="text-xs text-slate-600 space-y-1">
        {ordered(a.dimensions).filter(([, d]) => d.score != null).map(([k, d]) => (
          <li key={k}><span className="font-medium text-slate-700">{LABEL[k] ?? k}:</span> {d.reason}
            {!d.quote_verified && <span className="text-amber-700"> (the words the AI quoted aren’t in the answer; check yourself)</span>}</li>
        ))}
      </ul>
      {a.must_mention.required.length > 0 && (
        <p className="text-xs text-slate-600 mt-2">Should mention: {a.must_mention.required.map(m => (
          <span key={m} className={a.must_mention.covered.includes(m) ? 'text-emerald-700' : 'text-rose-700'}>{a.must_mention.covered.includes(m) ? '✓' : '✗'} {m} </span>
        ))}</p>
      )}
      {a.knockout && (
        <p className={`text-xs mt-2 ${a.knockout.passed ? 'text-emerald-700' : 'text-rose-700'}`}>
          Must-pass {a.knockout.passed === true ? 'met' : a.knockout.passed === false ? 'NOT met (check yourself)' : 'unclear'}: {a.knockout.rule}
        </p>
      )}
    </div>
  );
}
