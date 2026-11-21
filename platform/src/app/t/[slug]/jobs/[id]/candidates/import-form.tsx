'use client';

import { useActionState } from 'react';
import { Upload } from 'lucide-react';
import { buttonClass, fileInputClass } from '@/components/styles';
import { importCandidates, type ImportState } from './actions';

export function ImportForm({ slug, jobId }: { slug: string; jobId: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importCandidates.bind(null, slug, jobId), { status: 'idle' });
  return (
    <form action={action}>
      <div className="flex flex-wrap items-end gap-3">
        <input type="file" name="file" accept=".csv,text/csv" required aria-label="Candidate CSV file"
               className={`${fileInputClass} max-w-xs`} />
        <button disabled={pending} className={buttonClass()}>
          <Upload className="size-4" /> {pending ? 'Importing…' : 'Import'}
        </button>
      </div>
      {state.status === 'error' && <p role="alert" className="mt-3 text-sm text-rose-700">{state.message}</p>}
      {state.status === 'done' && (
        <div role="status" className="mt-4 text-sm">
          <p className="font-medium text-emerald-800">
            Added {state.added} candidate{state.added === 1 ? '' : 's'}.
            {state.duplicates > 0 && ` Skipped ${state.duplicates} already on this job (same phone or email).`}
          </p>
          {state.problems.length > 0 && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="font-medium text-amber-900 mb-1">{state.problems.length} row{state.problems.length === 1 ? ' was' : 's were'} not imported:</p>
              <ul className="max-h-48 overflow-y-auto text-amber-900 space-y-0.5">
                {state.problems.map((p, i) => <li key={i}>Row {p.row}: {p.message}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
