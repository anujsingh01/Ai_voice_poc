import type { Tx } from '@/db';

// Go-live targets from the plan (section 5C).
export const TARGETS = { withinOne: 0.8, shortlistAgreement: 0.85, quoteFailures: 0.02, minInterviews: 25 };

export type Rating = { interview_id: string; rater_id: string; dimensions: Record<string, number>; shortlist: boolean };
export type AiScore = { interview_id: string; total: number; dimensions: Record<string, { score: number | null; label: string; source: string }>; cutoff: number };

export type CalibrationReport = {
  interviews: number; ratings: number; raters: number;
  perDimension: { key: string; label: string; pairs: number; withinOne: number; meanDiff: number }[];
  withinOneOverall: number | null;     // share of (rating, dimension) pairs where |AI − human| ≤ 1
  shortlistAgreement: number | null;   // AI above cut-off vs the rater's "would shortlist"
  raterAgreement: number | null;       // two raters on the same interview, within one point
  quoteFailureRate: number | null;
  passes: { withinOne: boolean; shortlist: boolean; quotes: boolean; enough: boolean };
};

/** Pure calculation, so it can be tested on its own. */
export function buildReport(ratings: Rating[], ai: Map<string, AiScore>, quotes: { failures: number; total: number }): CalibrationReport {
  const dims = new Map<string, { label: string; pairs: number; within: number; diff: number }>();
  let shortlistPairs = 0, shortlistAgree = 0;
  for (const r of ratings) {
    const a = ai.get(r.interview_id);
    if (!a) continue;
    for (const [key, human] of Object.entries(r.dimensions)) {
      const aiDim = a.dimensions[key];
      if (aiDim?.score == null) continue;
      const d = dims.get(key) ?? { label: aiDim.label, pairs: 0, within: 0, diff: 0 };
      d.pairs++;
      if (Math.abs(aiDim.score - human) <= 1) d.within++;
      d.diff += aiDim.score - human;
      dims.set(key, d);
    }
    shortlistPairs++;
    if ((a.total >= a.cutoff) === r.shortlist) shortlistAgree++;
  }
  const perDimension = [...dims.entries()].map(([key, d]) => ({ key, label: d.label, pairs: d.pairs, withinOne: d.within / d.pairs, meanDiff: d.diff / d.pairs }));
  const totalPairs = perDimension.reduce((s, d) => s + d.pairs, 0);
  const withinOneOverall = totalPairs ? perDimension.reduce((s, d) => s + d.withinOne * d.pairs, 0) / totalPairs : null;

  // Rater vs rater on interviews rated twice (how consistent are humans themselves?).
  const byInterview = new Map<string, Rating[]>();
  for (const r of ratings) byInterview.set(r.interview_id, [...(byInterview.get(r.interview_id) ?? []), r]);
  let rr = 0, rrWithin = 0;
  for (const rs of byInterview.values()) {
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      for (const [k, v] of Object.entries(rs[i].dimensions)) {
        const w = rs[j].dimensions[k];
        if (w == null) continue;
        rr++; if (Math.abs(v - w) <= 1) rrWithin++;
      }
    }
  }
  const interviews = new Set(ratings.filter(r => ai.has(r.interview_id)).map(r => r.interview_id)).size;
  const shortlistAgreement = shortlistPairs ? shortlistAgree / shortlistPairs : null;
  const quoteFailureRate = quotes.total ? quotes.failures / quotes.total : null;
  return {
    interviews, ratings: ratings.length, raters: new Set(ratings.map(r => r.rater_id)).size,
    perDimension, withinOneOverall, shortlistAgreement, raterAgreement: rr ? rrWithin / rr : null, quoteFailureRate,
    passes: {
      withinOne: withinOneOverall != null && withinOneOverall >= TARGETS.withinOne,
      shortlist: shortlistAgreement != null && shortlistAgreement >= TARGETS.shortlistAgreement,
      quotes: quoteFailureRate != null && quoteFailureRate < TARGETS.quoteFailures,
      enough: interviews >= TARGETS.minInterviews,
    },
  };
}

export async function jobCalibration(tx: Tx, jobId: string) {
  const ratings = (await tx`
    SELECT cr.interview_id, cr.rater_id, cr.dimensions, cr.shortlist FROM calibration_ratings cr
    JOIN interviews iv ON iv.id = cr.interview_id WHERE iv.job_id = ${jobId}`) as unknown as Rating[];
  const scores = await tx`
    SELECT s.interview_id, s.total::float, s.dimensions, s.quote_failures, s.answers, r.shortlist_cutoff AS cutoff
    FROM scores s JOIN interviews iv ON iv.id = s.interview_id JOIN rubrics r ON r.id = iv.rubric_id
    WHERE iv.job_id = ${jobId} AND s.pass = 1`;
  const ai = new Map<string, AiScore>(scores.map(s => [s.interview_id, { interview_id: s.interview_id, total: s.total, dimensions: s.dimensions, cutoff: s.cutoff }]));
  // Quotes checked = every non-null AI dimension score on every answer.
  let total = 0, failures = 0;
  for (const s of scores) {
    failures += s.quote_failures;
    for (const a of (s.answers?.answers ?? []) as { dimensions: Record<string, { score: number | null }> }[]) {
      total += Object.values(a.dimensions).filter(d => d.score != null).length;
    }
  }
  return buildReport(ratings, ai, { failures, total });
}
