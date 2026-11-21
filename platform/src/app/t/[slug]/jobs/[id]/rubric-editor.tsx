'use client';

import { Gauge, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { buttonClass } from '@/components/styles';
import type { Dimension } from '@/lib/rubric';

/** Rubric weights with a live total, so it's obvious when they don't add up to 100. */
export function RubricEditor({ dims, cutoff, action, disabled }: {
  dims: Dimension[]; cutoff: number; action: (form: FormData) => void; disabled: boolean;
}) {
  const [weights, setWeights] = useState(() => Object.fromEntries(dims.map(d => [d.key, d.weight])));
  const total = Object.values(weights).reduce((s, w) => s + (Number(w) || 0), 0);
  const ok = total === 100;

  return (
    <form action={action}>
      <fieldset disabled={disabled}>
        <div className="space-y-3">
          {dims.map(d => {
            const w = Number(weights[d.key]) || 0;
            return (
              <div key={d.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[14rem_1fr_auto]">
                <div className="flex items-center gap-2 text-sm">
                  {d.source === 'ai' ? <Sparkles className="size-3.5 text-brand-500" /> : <Gauge className="size-3.5 text-sky-500" />}
                  <span className="font-medium text-slate-800">{d.label}</span>
                </div>
                <div className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-slate-100 sm:order-none sm:col-span-1">
                  <div className={`h-full rounded-full ${d.source === 'ai' ? 'bg-brand-500' : 'bg-sky-500'}`} style={{ width: `${Math.min(100, w)}%` }} />
                </div>
                <label className="flex items-center gap-1 text-sm text-slate-500">
                  <input type="number" name={`w_${d.key}`} value={weights[d.key]} min={0} max={100} required aria-label={`${d.label} weight`}
                         onChange={e => setWeights(x => ({ ...x, [d.key]: Number(e.target.value) }))}
                         className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-right font-medium tabular-nums text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15" />%
                </label>
              </div>
            );
          })}
        </div>
        <div className={`mt-5 flex items-center justify-between rounded-xl px-4 py-3 text-sm ${ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          <span className="font-medium">Total</span>
          <span className="font-semibold tabular-nums">{total}% {ok ? '✓' : `· must be exactly 100%`}</span>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <span>Shortlist candidates scoring at least</span>
          <input type="number" name="cutoff" defaultValue={cutoff} min={0} max={100} required aria-label="Shortlist cut-off"
                 className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-right font-medium tabular-nums focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15" />
          <span>out of 100</span>
        </div>
      </fieldset>
      {!disabled && <button className={`${buttonClass()} mt-6`} disabled={!ok}>Save rubric</button>}
      <p className="mt-4 flex gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><Sparkles className="size-3 text-brand-500" /> AI-judged against your model answers</span>
        <span className="inline-flex items-center gap-1"><Gauge className="size-3 text-sky-500" /> Measured from the audio</span>
      </p>
    </form>
  );
}
