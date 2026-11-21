'use client';

import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { buttonClass, controlClass, fileInputClass } from '@/components/styles';
import { uploadBank, type UploadState } from './actions';

export function UploadForm({ slug, banks, defaultBank }: { slug: string; banks: { id: string; name: string }[]; defaultBank?: string }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadBank.bind(null, slug), { status: 'idle' });
  const [target, setTarget] = useState(defaultBank ?? (banks.length ? banks[0].id : 'new'));
  // After creating a bank, point the form at it so the next upload adds a version instead.
  const [handled, setHandled] = useState(state);
  if (state !== handled) { setHandled(state); if (state.status === 'saved') setTarget(state.bankId); }

  return (
    <form action={action}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {!defaultBank && (
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Upload to</span>
            <select name="bank" value={target} onChange={e => setTarget(e.target.value)} className={`${controlClass} h-10`}>
              {banks.map(b => <option key={b.id} value={b.id}>{b.name} (new version)</option>)}
              <option value="new">A new question bank…</option>
            </select>
          </label>
        )}
        {defaultBank && <input type="hidden" name="bank" value={defaultBank} />}
        {target === 'new' && (
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">New bank name</span>
            <input name="new_name" required minLength={2} maxLength={120} placeholder="Field sales – 2026" className={`${controlClass} h-10`} />
          </label>
        )}
      </div>
      <label className="mb-5 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-6 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40">
        <span className="grid size-11 place-items-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-slate-200"><FileSpreadsheet className="size-5" /></span>
        <span className="text-sm font-medium text-slate-700">Choose the Excel file (.xlsx)</span>
        <input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className={`${fileInputClass} max-w-xs`} />
      </label>
      <button disabled={pending} className={buttonClass()}>
        <Upload className="size-4" /> {pending ? 'Checking every row…' : 'Check and upload'}
      </button>

      {state.status === 'errors' && (
        <div role="alert" className="mt-5 overflow-hidden rounded-xl border border-rose-200">
          <p className="flex items-center gap-2 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
            <AlertCircle className="size-4 text-rose-500" />
            Nothing was saved. Fix {state.errors.length === 1 ? 'this problem' : `these ${state.errors.length} problems`} in the file and upload it again.
          </p>
          <div className="max-h-80 overflow-y-auto bg-white">
            <table className="data-table">
              <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
              <tbody>
                {state.errors.map((e, i) => (
                  <tr key={i}>
                    <td className="tabular-nums text-slate-700">{e.row ?? '—'}</td>
                    <td className="font-mono text-xs text-slate-600">{e.column ?? ''}</td>
                    <td className="text-rose-800">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {state.status === 'saved' && (
        <div role="status" className="mt-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <span>Saved as version {state.version}: {state.questions} questions and {state.objections} customer objections.{' '}
            <Link href={`/t/${slug}/banks/${state.bankId}`} className="font-semibold underline">Open the bank to record audio →</Link></span>
        </div>
      )}
    </form>
  );
}
