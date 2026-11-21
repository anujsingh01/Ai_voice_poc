'use client';

// Microphone recording for the candidate app: one MediaStream, a level meter, and Opus/AAC output that
// stays small on cheap phones (~32 kbit/s mono).

export function supportsRecording() {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/**
 * Browsers built into other apps (Facebook, Instagram, Messenger, LINE, Snapchat, Android WebViews)
 * often refuse microphone access. Candidates who tap the link inside such an app are told to open it
 * in Chrome or Safari instead. WhatsApp and SMS links normally open in the real browser.
 */
export function isInAppBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|Snapchat|; wv\)|GSA\//i.test(navigator.userAgent);
}

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export class MicSession {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(2048);

  async open() {
    if (this.stream?.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
  }

  /** Current loudness, 0..1 (RMS of the latest ~40 ms). */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  }

  /** Starts recording; resolves with the audio when `stop()` on the returned handle is called. */
  record() {
    if (!this.stream) throw new Error('Microphone not open');
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    const mimeType = pickMime();
    const rec = new MediaRecorder(this.stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32000 });
    const chunks: Blob[] = [];
    const started = performance.now();
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<{ blob: Blob; durationMs: number }>(resolve => {
      rec.onstop = () => resolve({ blob: new Blob(chunks, { type: rec.mimeType || mimeType }), durationMs: performance.now() - started });
    });
    rec.start(1000);
    return { stop: () => { if (rec.state !== 'inactive') rec.stop(); return done; }, started };
  }

  close() {
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close();
    this.stream = null; this.ctx = null; this.analyser = null;
  }
}

/** PUT with retries and backoff; safe to repeat because the server treats the same attempt as a replace. */
export async function uploadWithRetry(url: string, blob: Blob, onRetry: (n: number) => void, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
      if (r.ok) return { ok: true as const };
      if (r.status < 500 && r.status !== 429) return { ok: false as const, problem: ((await r.json().catch(() => ({}))) as { problem?: string }).problem ?? 'error' };
    } catch { /* network error: retry */ }
    onRetry(i + 1);
    await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** i, 15000)));
  }
  return { ok: false as const, problem: 'network' };
}
