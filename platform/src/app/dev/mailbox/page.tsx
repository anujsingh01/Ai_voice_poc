import { Mail, Smartphone } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { sql } from '@/db';
import { driverFor, enabledChannels, isLocal } from '@/lib/env';

export const dynamic = 'force-dynamic';

// Local development only: what the "dev" sending driver would have sent. Never available on AWS (staging or production).
export default async function DevMailbox() {
  if (!isLocal() || !enabledChannels().some(c => driverFor(c) === 'dev')) notFound();
  const rows = await sql`SELECT * FROM dev_mailbox ORDER BY id DESC LIMIT 50`;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-xl font-semibold text-slate-900">Dev mailbox</h1>
      <p className="mt-1 text-sm text-slate-500">
        Emails and SMS the platform sent on this computer. Nothing here left the machine. Newest first; refresh to update.
      </p>
      {rows.length === 0 && <p className="mt-8 text-sm text-slate-500">Nothing sent yet.</p>}
      <ul className="mt-6 space-y-4">
        {rows.map(m => (
          <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {m.channel === 'email' ? <Mail className="size-4 text-brand-600" /> : <Smartphone className="size-4 text-sky-600" />}
              <span className="font-semibold uppercase text-slate-700">{m.channel}</span>
              <span>to {m.to_address}</span>
              <span className="ml-auto">{new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
            {m.subject && <p className="mt-2 font-medium text-slate-900">{m.subject}</p>}
            <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700">
              {String(m.body).split(/(https?:\/\/\S+)/).map((part, i) =>
                i % 2 ? <a key={i} href={part} className="font-medium text-brand-600 underline">{part}</a> : <Fragment key={i}>{part}</Fragment>)}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
