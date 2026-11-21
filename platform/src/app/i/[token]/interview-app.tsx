'use client';

import { useEffect, useRef, useState } from 'react';
import { isInAppBrowser, MicSession, supportsRecording, uploadWithRetry } from './recorder';
import { NATIVE_NAME, SPEECH_LANG, stringsFor, type Strings } from './strings';

type Question = { position: number; code: string; type: string; text: string; hasAudio: boolean; answered: boolean; attempt: number };
type State = {
  company: string; jobTitle: string; description: string | null; candidateName: string;
  languages: string[]; preferredLanguage: string | null; consent: Record<string, string>;
  answerSeconds: number; minSeconds: number;
  interview: { status: string; language: string; questions: Question[] } | null;
};
type Step = 'loading' | 'problem' | 'language' | 'notice' | 'under18' | 'mic' | 'questions' | 'done' | 'error';

const card = 'max-w-md mx-auto bg-white rounded-3xl p-6 shadow-xl shadow-slate-900/5 ring-1 ring-slate-900/5';
const primary = 'w-full rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition active:scale-[0.98] active:bg-brand-700 disabled:opacity-40 disabled:shadow-none';
const secondary = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base font-medium text-slate-800 transition active:scale-[0.98] active:bg-slate-50 disabled:opacity-40';

export function InterviewApp({ token }: { token: string }) {
  const [step, setStep] = useState<Step>('loading');
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState<string>('');
  const [lang, setLang] = useState<string>('');
  const mic = useRef<MicSession | null>(null);
  // Only shown after the first fetch, so reading navigator here can't cause a hydration mismatch.
  const [inApp] = useState(() => typeof navigator !== 'undefined' && isInAppBrowser());
  const [micSession, setMicSession] = useState<MicSession | null>(null);
  const t = stringsFor(state?.interview?.language ?? lang);

  useEffect(() => {
    const session = mic;   // the ref object is stable; its current value is read at cleanup on purpose
    fetch(`/api/i/${token}/state`, { cache: 'no-store' }).then(r => r.json()).then(data => {
      if (data.problem) { if (data.language) setLang(data.language); setProblem(data.problem); setStep('problem'); return; }
      setState(data);
      if (data.interview) {
        setLang(data.interview.language);
        setStep(data.interview.questions.every((q: Question) => q.answered) && data.interview.status !== 'in_progress' ? 'done' : 'mic');
      } else {
        setLang(data.preferredLanguage && data.languages.includes(data.preferredLanguage) ? data.preferredLanguage : data.languages.length === 1 ? data.languages[0] : '');
        setStep(data.languages.length === 1 || (data.preferredLanguage && data.languages.includes(data.preferredLanguage)) ? 'notice' : 'language');
      }
    }).catch(() => setStep('error'));
    return () => session.current?.close();
  }, [token]);

  if (step === 'loading') return <Shell><div className={card}><p className="text-slate-500">…</p></div></Shell>;
  if (step === 'error') return <Shell><div className={card}><p className="text-slate-700">{t.genericError}</p></div></Shell>;
  if (step === 'problem') return (
    <Shell><div className={card}>
      <h1 className="text-lg font-semibold mb-2">{problem === 'completed' ? t.doneTitle : t.problemTitle}</h1>
      <p className="text-slate-700">{t.problems[problem] ?? t.genericError}</p>
    </div></Shell>
  );
  if (!state) return null;

  return (
    <Shell company={state.company} job={state.jobTitle} token={token}>
      {inApp && step !== 'done' && step !== 'under18' && <OpenInBrowser t={t} />}
      {step === 'language' && <LanguageStep state={state} lang={lang} setLang={setLang} onNext={() => setStep('notice')} />}
      {step === 'notice' && (
        <NoticeStep t={t} text={state.consent[lang]} lang={lang} onUnder18={() => setStep('under18')}
                    onAccept={async () => {
                      const r = await fetch(`/api/i/${token}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ language: lang, consent: true, adult: true }) });
                      const data = await r.json();
                      if (!r.ok) { setProblem(data.problem); setStep(data.problem === 'under_18' ? 'under18' : 'problem'); return; }
                      setState(data); setStep('mic');
                    }} />
      )}
      {step === 'under18' && <div className={card}><h1 className="text-lg font-semibold mb-2">{t.under18Title}</h1><p className="text-slate-700">{t.under18Body}</p></div>}
      {step === 'mic' && <MicStep t={t} mic={mic} onReady={() => { setMicSession(mic.current); setStep('questions'); }} />}
      {step === 'questions' && state.interview && micSession && (
        <QuestionsStep t={t} token={token} state={state} mic={micSession} onDone={() => { mic.current?.close(); setStep('done'); }} />
      )}
      {step === 'done' && <div className={card}><h1 className="text-xl font-semibold mb-2">{t.doneTitle}</h1><p className="text-slate-700">{t.doneBody}</p></div>}
    </Shell>
  );
}

/** Advice for candidates whose link opened inside another app's browser, with a copy-link button. */
function OpenInBrowser({ t }: { t: Strings }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="alert" className="max-w-md mx-auto mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-[15px] text-amber-900">
      <p className="mb-3">{t.inAppBrowser}</p>
      <button type="button" className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white"
              onClick={() => navigator.clipboard?.writeText(location.href).then(() => setCopied(true))}>
        {t.copyLink}
      </button>
      {copied && <p className="mt-2 text-sm">{t.linkCopied}</p>}
    </div>
  );
}

function Shell({ company, job, children, token }: { company?: string; job?: string; children: React.ReactNode; token?: string }) {
  return (
    <main className="min-h-dvh bg-slate-50">
      <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-4 pb-16 pt-6 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{company ?? 'Voice interview'}</p>
            {job && <p className="truncate text-sm text-white/75">{job}</p>}
          </div>
        </div>
      </div>
      <div className="-mt-10 px-4 pb-10">{children}</div>
      {token && (
        <p className="pb-8 text-center text-xs text-slate-400">
          <a href={`/i/${token}/privacy`} className="underline underline-offset-2 hover:text-slate-600">Your data and privacy</a>
        </p>
      )}
    </main>
  );
}

function LanguageStep({ state, lang, setLang, onNext }: { state: State; lang: string; setLang: (l: string) => void; onNext: () => void }) {
  return (
    <div className={card}>
      <h1 className="text-lg font-semibold mb-4">Choose your interview language / भाषा चुनें</h1>
      <div className="space-y-2 mb-5">
        {state.languages.map(l => (
          <label key={l} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-lg ${lang === l ? 'border-brand-600 bg-brand-50' : 'border-slate-300'}`}>
            <input type="radio" name="lang" value={l} checked={lang === l} onChange={() => setLang(l)} className="w-5 h-5" />
            {NATIVE_NAME[l] ?? l}
          </label>
        ))}
      </div>
      <button className={primary} disabled={!lang} onClick={onNext}>{stringsFor(lang).continue} →</button>
    </div>
  );
}

function NoticeStep({ t, text, lang, onAccept, onUnder18 }: { t: Strings; text: string; lang: string; onAccept: () => Promise<void>; onUnder18: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [adult, setAdult] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => { if (canSpeak) speechSynthesis.cancel(); }, [canSpeak]);

  const listen = () => {
    if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANG[lang] ?? lang;
    u.rate = 0.95;
    u.onend = u.onerror = () => setSpeaking(false);
    speechSynthesis.speak(u);
    setSpeaking(true);
  };

  return (
    <div className={card}>
      <div className="flex items-center mb-3">
        <h1 className="text-lg font-semibold">{t.noticeTitle}</h1>
        {canSpeak && <button onClick={listen} className="ml-auto text-sm font-medium text-brand-700 border border-brand-200 rounded-lg px-3 py-1.5">{speaking ? t.stopListening : t.listen}</button>}
      </div>
      <div lang={lang} className="text-[15px] leading-relaxed text-slate-700 whitespace-pre-line max-h-[45dvh] overflow-y-auto border border-slate-100 rounded-lg p-3 mb-4 bg-slate-50">{text}</div>
      <label className="flex gap-3 items-start mb-4 text-base">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="w-5 h-5 mt-0.5 shrink-0" />
        <span>{t.agree}</span>
      </label>
      <p className="text-base font-medium mb-2">{t.ageQuestion}</p>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {([true, false] as const).map(v => (
          <button key={String(v)} type="button" onClick={() => setAdult(v)}
                  className={`rounded-xl border px-4 py-3 text-base ${adult === v ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-300'}`}>
            {v ? t.yes : t.no}
          </button>
        ))}
      </div>
      <button className={primary} disabled={!agreed || adult === null || busy}
              onClick={async () => { if (adult === false) return onUnder18(); setBusy(true); await onAccept(); setBusy(false); }}>
        {t.agreeAndContinue}
      </button>
    </div>
  );
}

function LevelMeter({ mic, active }: { mic: MicSession | null; active: boolean }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active || !mic) return;
    let raf = 0;
    const tick = () => { setLevel(mic.level()); raf = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [mic, active]);
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden" aria-hidden>
      <div className="h-full bg-green-500 transition-[width] duration-75" style={{ width: `${Math.min(100, level * 400)}%` }} />
    </div>
  );
}

function MicStep({ t, mic, onReady }: { t: Strings; mic: React.RefObject<MicSession | null>; onReady: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'listening' | 'good' | 'quiet' | 'blocked' | 'unsupported'>(supportsRecording() ? 'idle' : 'unsupported');
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  const test = async () => {
    try {
      mic.current ??= new MicSession();
      await mic.current.open();
    } catch { setPhase('blocked'); return; }
    setPhase('listening');
    const handle = mic.current.record();
    let peak = 0;
    const timer = setInterval(() => { peak = Math.max(peak, mic.current?.level() ?? 0); }, 50);
    await new Promise(r => setTimeout(r, 4000));
    clearInterval(timer);
    const { blob } = await handle.stop();
    setPlaybackUrl(URL.createObjectURL(blob));
    setPhase(peak > 0.03 ? 'good' : 'quiet');
  };

  return (
    <div className={card}>
      <h1 className="text-lg font-semibold mb-2">{t.micTitle}</h1>
      {phase === 'unsupported' ? <><p className="text-red-700 mb-3">{t.noMicSupport}</p><OpenInBrowser t={t} /></> : (
        <>
          <p className="text-slate-700 mb-4">{t.micBody}</p>
          {phase === 'listening' && <><p className="font-medium text-brand-700 mb-2">{t.micListening}</p><LevelMeter mic={mic.current} active /></>}
          {phase === 'good' && <p className="text-green-700 font-medium mb-3">✓ {t.micGood}</p>}
          {phase === 'quiet' && <p className="text-amber-700 mb-3">{t.micQuiet}</p>}
          {phase === 'blocked' && <><p className="text-red-700 mb-3">{t.micBlocked}</p>{isInAppBrowser() && <OpenInBrowser t={t} />}</>}
          {playbackUrl && phase !== 'listening' && <audio controls src={playbackUrl} className="w-full mb-4" aria-label={t.playback} />}
          <div className="space-y-2 mt-4">
            {phase === 'good' && <button className={primary} onClick={onReady}>{t.startInterview} →</button>}
            {phase !== 'listening' && phase !== 'blocked' && (
              <button className={phase === 'good' ? secondary : primary} onClick={test}>{phase === 'idle' ? t.micStart : t.micAgain}</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QuestionsStep({ t, token, state, mic, onDone }: { t: Strings; token: string; state: State; mic: MicSession; onDone: () => void }) {
  const [questions, setQuestions] = useState(state.interview!.questions);
  const firstOpen = questions.findIndex(q => !q.answered);
  const [index, setIndex] = useState(firstOpen === -1 ? questions.length - 1 : firstOpen);
  const [phase, setPhase] = useState<'ready' | 'recording' | 'uploading' | 'saved' | 'failed'>(questions[index]?.answered ? 'saved' : 'ready');
  const [elapsed, setElapsed] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [retrying, setRetrying] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const handle = useRef<ReturnType<MicSession['record']> | null>(null);
  const pending = useRef<{ blob: Blob; durationMs: number; attempt: number } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const q = questions[index];
  const max = state.answerSeconds, min = state.minSeconds;

  // Count up while recording, warn about low volume, and stop automatically at the time limit.
  useEffect(() => {
    if (phase !== 'recording') return;
    let quietFor = 0;
    const id = setInterval(() => {
      const s = (performance.now() - handle.current!.started) / 1000;
      setElapsed(s);
      quietFor = mic.level() < 0.01 ? quietFor + 0.25 : 0;
      setQuiet(quietFor > 4);
      if (s >= max) void stop();
    }, 250);
    return () => clearInterval(id);
  });

  const play = () => {
    audio.current?.pause();
    if (!q.hasAudio) return;
    audio.current = new Audio(`/api/i/${token}/question/${q.position}`);
    void audio.current.play();
  };

  const start = () => { audio.current?.pause(); handle.current = mic.record(); setElapsed(0); setQuiet(false); setPhase('recording'); };

  const upload = async () => {
    const p = pending.current!;
    setPhase('uploading'); setRetrying(0);
    const r = await uploadWithRetry(`/api/i/${token}/answer/${q.position}?attempt=${p.attempt}&duration_ms=${Math.round(p.durationMs)}`, p.blob, setRetrying);
    if (!r.ok) { setPhase('failed'); return; }
    pending.current = null;
    setQuestions(qs => qs.map((x, i) => (i === index ? { ...x, answered: true, attempt: p.attempt } : x)));
    setPhase('saved');
  };

  async function stop() {
    if (!handle.current) return;
    const h = handle.current; handle.current = null;
    const { blob, durationMs } = await h.stop();
    pending.current = { blob, durationMs, attempt: q.answered ? 2 : 1 };
    await upload();
  }

  const next = async () => {
    if (index < questions.length - 1) { setIndex(index + 1); setPhase('ready'); return; }
    setFinishing(true);
    const r = await fetch(`/api/i/${token}/finish`, { method: 'POST' });
    setFinishing(false);
    if (r.ok) onDone(); else setPhase('failed');
  };

  return (
    <div className={card}>
      <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
        <span>{t.questionOf(index + 1, questions.length)}</span>
        <span className="flex gap-1" aria-hidden>{questions.map((x, i) => <span key={i} className={`w-2 h-2 rounded-full ${x.answered ? 'bg-green-500' : i === index ? 'bg-brand-500' : 'bg-slate-200'}`} />)}</span>
      </div>
      <div className="h-1 bg-slate-100 rounded mb-4 overflow-hidden"><div className="h-full bg-brand-500" style={{ width: `${(100 * questions.filter(x => x.answered).length) / questions.length}%` }} /></div>
      {q.type === 'objection' && <p className="text-xs font-medium text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-3">{t.objection}</p>}
      <p lang={state.interview!.language} className="text-lg leading-relaxed text-slate-900 mb-4">{q.text}</p>
      {q.hasAudio && phase === 'ready' && (
        <button onClick={play} className="text-sm font-medium text-brand-700 border border-brand-200 rounded-lg px-3 py-1.5 mb-4">{t.playQuestion}</button>
      )}

      {phase === 'ready' && (
        <>
          <button className={primary} onClick={start}>{t.record}</button>
          <p className="text-sm text-slate-500 mt-2 text-center">{t.minNote(min)}</p>
        </>
      )}
      {phase === 'recording' && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full bg-red-600 animate-pulse" aria-hidden />
            <span className="font-mono tabular-nums text-lg">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</span>
            <span className="ml-auto text-sm text-slate-500">{t.timeLeft(Math.max(0, Math.ceil(max - elapsed)))}</span>
          </div>
          <LevelMeter mic={mic} active />
          {quiet && <p className="text-amber-700 text-sm mt-2">{t.louder}</p>}
          <button className={`${primary} mt-4 bg-red-600 active:bg-red-700`} disabled={elapsed < min} onClick={() => void stop()}>
            {elapsed < min ? `${t.stop} (${Math.ceil(min - elapsed)})` : t.stop}
          </button>
        </>
      )}
      {phase === 'uploading' && <p className="text-slate-600 py-3">{retrying ? t.uploadRetry : t.uploading}</p>}
      {phase === 'failed' && (
        <>
          <p className="text-red-700 mb-3">{t.uploadFailed}</p>
          <button className={primary} onClick={() => (pending.current ? void upload() : void next())}>{t.retryUpload}</button>
        </>
      )}
      {phase === 'saved' && (
        <>
          <p className="text-green-700 font-medium mb-4">✓ {t.saved}</p>
          <div className="space-y-2">
            <button className={primary} disabled={finishing} onClick={() => void next()}>{index < questions.length - 1 ? `${t.next} →` : t.finish}</button>
            {q.attempt === 1 && <button className={secondary} onClick={start}>{t.rerecord}</button>}
          </div>
        </>
      )}
    </div>
  );
}
