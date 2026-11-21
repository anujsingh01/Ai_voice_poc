'use client';

import { useActionState, useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { buttonClass, controlClass, linkActionClass } from '@/components/styles';
import { createWorker, type NewWorkerState } from './actions';

export function NewWorkerForm({ appUrl }: { appUrl: string }) {
  const [state, action, pending] = useActionState<NewWorkerState, FormData>(createWorker, { status: 'idle' });
  const [copied, setCopied] = useState(false);
  return (
    <form action={action}>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">PC name</span>
          <input name="name" required minLength={2} maxLength={80} placeholder="Office GPU 1" className={`${controlClass} h-10 w-64`} />
        </label>
        <button disabled={pending} className={buttonClass()}><KeyRound className="size-4" /> Register PC</button>
      </div>
      {state.status === 'error' && <p role="alert" className="mt-3 text-sm text-rose-700">{state.message}</p>}
      {state.status === 'created' && (
        <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="mb-3 text-emerald-900">
            <b>{state.name}</b> registered. Copy this token now: it is shown only once. Put it in the worker’s <code>.env</code> file on that PC:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-emerald-200">{`PLATFORM_URL=${appUrl}\nWORKER_TOKEN=${state.token}`}</pre>
          <button type="button" className={`mt-2 ${linkActionClass()}`}
                  onClick={() => navigator.clipboard.writeText(`PLATFORM_URL=${appUrl}\nWORKER_TOKEN=${state.token}\n`).then(() => setCopied(true))}>
            {copied ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
          </button>
        </div>
      )}
    </form>
  );
}
