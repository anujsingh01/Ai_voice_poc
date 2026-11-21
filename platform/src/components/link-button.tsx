'use client';

import { Check, Copy, Link2, MessageCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { linkActionClass } from './styles';

/**
 * Button that calls a server action returning a one-time link (set-password, invite) and shows it
 * once, with a copy button. The link is never stored in readable form, so it can't be shown again.
 */
export function LinkButton({ create, label = 'Create set-password link', whatsapp }: {
  create: () => Promise<{ link: string } | { error: string }>; label?: string;
  /** Optional "Share on WhatsApp": opens the user's own WhatsApp with this message; {link} is replaced. */
  whatsapp?: { phone: string; message: string };
}) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  if (link) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <input readOnly value={link} onFocus={e => e.target.select()} aria-label="One-time link"
               className="h-8 w-56 rounded-md border border-slate-200 bg-slate-50 px-2 font-mono text-[11px] text-slate-600" />
        <button type="button" className={linkActionClass()} onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>
          {copied ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
        </button>
        {whatsapp && (
          <a target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
             href={`https://wa.me/${whatsapp.phone.replace(/\D/g, '')}?text=${encodeURIComponent(whatsapp.message.replace('{link}', link))}`}>
            <MessageCircle className="size-3.5" /> WhatsApp
          </a>
        )}
      </div>
    );
  }
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" disabled={pending} className={linkActionClass()}
              onClick={() => start(async () => {
                const r = await create();
                if ('link' in r) setLink(r.link); else setError(r.error);
              })}>
        <Link2 className="size-3.5" /> {pending ? 'Creating…' : label}
      </button>
      {error && <span className="mt-1 max-w-64 text-right text-xs text-rose-700">{error}</span>}
    </span>
  );
}
