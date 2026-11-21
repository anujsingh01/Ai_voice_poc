// Confidence and fluency, measured from the audio (via the transcription worker's metrics), never judged
// by AI. Starting thresholds; Day 6 calibration against recruiters' ratings adjusts them.
// Accent, grammar and choice of language are never measured.

export type AnswerMetrics = {
  duration_seconds: number; speech_seconds: number; pause_count: number; long_pauses: number;
  words: number; words_per_minute: number; filler_count: number;
};

// Comfortable speaking pace by language, in words per minute (Tamil words are longer, so fewer per minute).
const PACE: Record<string, [number, number]> = { en: [110, 170], hi: [110, 180], ta: [70, 130] };
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

/** 1–5: did they speak up and keep going, or hesitate and stop early? */
export function confidenceScore(m: AnswerMetrics) {
  let s = 5;
  const ratio = m.duration_seconds > 0 ? m.speech_seconds / m.duration_seconds : 0;
  if (ratio < 0.5) s -= 2; else if (ratio < 0.7) s -= 1;
  if (m.speech_seconds < 10) s -= 2; else if (m.speech_seconds < 20) s -= 1;
  if (m.long_pauses > 2) s -= 1;
  return clamp(s);
}

/** 1–5: steady pace, few fillers and pauses. */
export function fluencyScore(m: AnswerMetrics, language: string) {
  let s = 5;
  const [lo, hi] = PACE[language] ?? [90, 170];
  const wpm = m.words_per_minute;
  if (wpm < lo) s -= Math.ceil((lo - wpm) / 25);
  if (wpm > hi) s -= Math.ceil((wpm - hi) / 25);
  const minutes = Math.max(m.speech_seconds / 60, 0.25);
  const fillersPerMin = m.filler_count / minutes, pausesPerMin = m.pause_count / minutes;
  if (fillersPerMin > 6) s -= 2; else if (fillersPerMin > 3) s -= 1;
  if (pausesPerMin > 8) s -= 1;
  return clamp(s);
}

export const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
