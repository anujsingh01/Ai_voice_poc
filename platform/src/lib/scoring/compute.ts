import { z } from 'zod';
import type { Dimension } from '../rubric';
import { average, confidenceScore, fluencyScore, type AnswerMetrics } from './measured';
import type { ScoringInput } from './prompt';

// Everything after the AI call happens here, in code: validating the reply, checking every quote really
// appears in the transcript, combining scores with the rubric weights, and deciding what needs a human.

const evidence = z.object({ score: z.number().int().min(1).max(5).nullable(), quote: z.string(), reason: z.string() });
export const aiReply = z.object({
  answers: z.array(z.object({
    answer_id: z.string(),
    dimensions: z.record(z.string(), evidence),
    must_mention_covered: z.array(z.string()),
    knockout: z.object({ applies: z.boolean(), passed: z.boolean().nullable(), quote: z.string() }),
  })),
  summary: z.string(), strengths: z.array(z.string()), concerns: z.array(z.string()),
});
export type AiReply = z.infer<typeof aiReply>;

const norm = (s: string) =>
  s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** True when the quote is really in the transcript (ignoring case, punctuation and spacing). */
export function quoteFound(quote: string, transcript: string) {
  const q = norm(quote), t = norm(transcript);
  if (!q) return false;
  if (t.includes(q)) return true;
  // Tolerate one changed word in a longer quote (models sometimes fix a misrecognised word).
  const qw = q.split(' '), tw = t.split(' ');
  if (qw.length < 5) return false;
  for (let i = 0; i + qw.length <= tw.length; i++) {
    let diff = 0;
    for (let j = 0; j < qw.length && diff <= 1; j++) if (tw[i + j] !== qw[j]) diff++;
    if (diff <= 1) return true;
  }
  return false;
}

export type AnswerForScoring = ScoringInput['answers'][number] & { metrics: AnswerMetrics | null; low_confidence: boolean | null; code: string };

export type ComputedScore = {
  dimensions: Record<string, { score: number | null; weight: number; source: 'ai' | 'measured'; label: string }>;
  answers: unknown[];
  total: number;
  quoteFailures: number;
  flags: { type: string; detail: string; answer?: string }[];
};

/** Validates the AI reply against the request and turns it into the stored score. Throws if the reply is unusable. */
export function computeScore(reply: AiReply, answers: AnswerForScoring[], rubric: Dimension[], language: string): ComputedScore {
  const aiDims = rubric.filter(d => d.source === 'ai').map(d => d.key);
  const byId = new Map(reply.answers.map(a => [a.answer_id, a]));
  const missing = answers.filter(a => !byId.has(a.answer_id));
  if (missing.length) throw new Error(`Reply is missing answers: ${missing.map(a => a.answer_id).join(', ')}`);

  let quoteFailures = 0;
  const flags: ComputedScore['flags'] = [];
  const perAnswer = answers.map(a => {
    const r = byId.get(a.answer_id)!;
    const dims: Record<string, { score: number | null; quote: string; reason: string; quote_verified: boolean }> = {};
    for (const key of aiDims) {
      const e = r.dimensions[key];
      if (!e) throw new Error(`Reply has no "${key}" score for ${a.answer_id}`);
      // A score above 1 must be backed by words the candidate actually said.
      const verified = e.score === null || (e.score === 1 && !e.quote) || quoteFound(e.quote, a.transcript);
      if (!verified) quoteFailures++;
      dims[key] = { ...e, quote_verified: verified };
    }
    const knockout = a.knockout_rule ? { rule: a.knockout_rule, passed: r.knockout.passed, quote: r.knockout.quote } : null;
    if (knockout && knockout.passed !== true) {
      flags.push({ type: 'knockout', answer: a.code, detail: knockout.passed === false ? `Did not meet: ${a.knockout_rule}` : `Unclear: ${a.knockout_rule}` });
    }
    if (a.low_confidence) flags.push({ type: 'low_transcript_confidence', answer: a.code, detail: 'Listen to the recording; the transcript may be unreliable.' });
    const covered = a.must_mention.filter(m => r.must_mention_covered.some(c => norm(c) === norm(m)));
    return {
      answer_id: a.answer_id, code: a.code, weight: a.weight, dimensions: dims, knockout, must_mention: { required: a.must_mention, covered },
      measured: a.metrics ? { confidence: confidenceScore(a.metrics), fluency: fluencyScore(a.metrics, language) } : null,
    };
  });

  const dimensions: ComputedScore['dimensions'] = {};
  for (const d of rubric) {
    let score: number | null;
    if (d.source === 'ai') {
      // Weighted by each question's importance (weight 1–5 from the question bank); n/a answers skipped.
      let sum = 0, w = 0;
      for (const a of perAnswer) {
        const s = a.dimensions[d.key]?.score;
        if (s != null) { sum += s * a.weight; w += a.weight; }
      }
      score = w ? sum / w : null;
    } else {
      score = average(perAnswer.map(a => a.measured?.[d.key as 'confidence' | 'fluency']).filter((x): x is number => x != null));
    }
    dimensions[d.key] = { score: score == null ? null : Math.round(score * 100) / 100, weight: d.weight, source: d.source, label: d.label };
  }
  // 0–100: each dimension's 1–5 score mapped to 0–1 and weighted; dimensions without a score are left out.
  const scored = Object.values(dimensions).filter(d => d.score != null);
  const wsum = scored.reduce((s, d) => s + d.weight, 0);
  const total = wsum ? Math.round((10 * 100 * scored.reduce((s, d) => s + d.weight * ((d.score! - 1) / 4), 0)) / wsum) / 10 : 0;
  return { dimensions, answers: perAnswer, total, quoteFailures, flags };
}

/** Second opinion disagrees if any dimension differs by more than one point. */
export function passesDisagree(a: ComputedScore['dimensions'], b: ComputedScore['dimensions']) {
  return Object.keys(a).some(k => a[k].score != null && b[k]?.score != null && Math.abs(a[k].score! - b[k].score!) > 1);
}

export const CLOSE_CALL_POINTS = 5;
export const isCloseCall = (total: number, cutoff: number) => Math.abs(total - cutoff) <= CLOSE_CALL_POINTS;
