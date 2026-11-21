'use client';

import { useRef, useState, useTransition } from 'react';
import { Mic, Square, Trash2, Upload } from 'lucide-react';
import { linkActionClass } from '@/components/styles';
import { deleteQuestionAudio, saveQuestionAudio } from './actions';

type Props = {
  slug: string; bankId: string; code: string; language: string;
  audio: { id: string } | null; canEdit: boolean;
};

/** Play, record (with the microphone) or upload the spoken version of one question in one language. */
export function AudioCell({ slug, bankId, code, language, audio, canEdit }: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = (blob: Blob, name: string) => start(async () => {
    setError(null);
    const form = new FormData();
    form.append('audio', new File([blob], name, { type: blob.type }));
    const r = await saveQuestionAudio(slug, bankId, code, language, form);
    if ('error' in r) setError(r.error);
  });

  async function toggleRecord() {
    if (recording) { recorder.current?.stop(); return; }
    setError(null);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { setError('Microphone blocked. Allow it in the browser’s address bar.'); return; }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      setRecording(false);
      upload(new Blob(chunks, { type: rec.mimeType }), `${code}-${language}.webm`);
    };
    recorder.current = rec;
    rec.start();
    setRecording(true);
  }

  return (
    <div className="min-w-56">
      {audio && !recording && (
        <audio controls preload="none" src={`/t/${slug}/audio/${audio.id}`} className="h-8 w-56" aria-label={`${code} audio`} />
      )}
      {!audio && !recording && !pending && <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">No audio yet</span>}
      {canEdit && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button type="button" onClick={toggleRecord} disabled={pending}
                  className={recording ? 'inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white animate-pulse' : linkActionClass()}>
            {recording ? <><Square className="size-3" /> Stop and save</> : <><Mic className="size-3.5" /> {audio ? 'Re-record' : 'Record'}</>}
          </button>
          {!recording && (
            <>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={pending} className={linkActionClass()}><Upload className="size-3.5" /> Upload</button>
              {audio && (
                <button type="button" disabled={pending} className={linkActionClass('muted')} aria-label="Delete recording"
                        onClick={() => confirm('Delete this recording?') && start(() => deleteQuestionAudio(slug, bankId, audio.id))}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </>
          )}
          {pending && <span className="px-1.5 py-1 text-xs text-slate-500">Saving…</span>}
          <input ref={fileInput} type="file" accept="audio/*" className="hidden"
                 onChange={e => { const f = e.target.files?.[0]; if (f) upload(f, f.name); e.target.value = ''; }} />
        </div>
      )}
      {error && <p className="text-xs text-rose-700 mt-1">{error}</p>}
    </div>
  );
}
