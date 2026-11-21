'use client';

import { Check, Copy, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { linkActionClass } from '@/components/styles';

/** The backup codes, with copy / download / print. Shown once: they can't be read back later. */
export function BackupCodes({ codes, email }: { codes: string[]; email: string }) {
  const [copied, setCopied] = useState(false);
  const text = `InterviewPlatform backup codes for ${email}\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
  return (
    <div>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 font-mono text-[15px] tracking-wide text-slate-900">
        {codes.map(c => <li key={c}>{c}</li>)}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button type="button" className={linkActionClass()} onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
        </button>
        <a className={linkActionClass()} download="interview-platform-backup-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>
          <Download className="size-3.5" /> Download
        </a>
        <button type="button" className={linkActionClass()} onClick={() => window.print()}>
          <Printer className="size-3.5" /> Print
        </button>
      </div>
    </div>
  );
}
