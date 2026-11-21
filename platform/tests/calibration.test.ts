import { describe, expect, it } from 'vitest';
import { buildReport, type AiScore, type Rating } from '../src/lib/calibration';

const ai = (id: string, total: number, scores: Record<string, number | null>): AiScore => ({
  interview_id: id, total, cutoff: 60,
  dimensions: Object.fromEntries(Object.entries(scores).map(([k, score]) => [k, { score, label: k, source: 'ai' }])),
});
const rating = (id: string, rater: string, dims: Record<string, number>, shortlist: boolean): Rating => ({ interview_id: id, rater_id: rater, dimensions: dims, shortlist });

describe('calibration report', () => {
  it('measures within-one agreement, bias direction and shortlist agreement', () => {
    const aiMap = new Map([
      ['a', ai('a', 72, { content: 4, persuasion: 2 })],
      ['b', ai('b', 40, { content: 3, persuasion: null })],
    ]);
    const r = buildReport([
      rating('a', 'u1', { content: 4, persuasion: 4 }, true),   // persuasion off by 2 (AI harsher)
      rating('b', 'u1', { content: 2, persuasion: 3 }, true),   // AI says not shortlisted, human says yes
    ], aiMap, { failures: 1, total: 100 });
    const content = r.perDimension.find(d => d.key === 'content')!;
    const persuasion = r.perDimension.find(d => d.key === 'persuasion')!;
    expect(content).toMatchObject({ pairs: 2, withinOne: 1, meanDiff: 0.5 });
    expect(persuasion).toMatchObject({ pairs: 1, withinOne: 0, meanDiff: -2 }); // null AI score is skipped
    expect(r.withinOneOverall).toBeCloseTo(2 / 3);
    expect(r.shortlistAgreement).toBe(0.5);
    expect(r.quoteFailureRate).toBe(0.01);
    expect(r.passes).toEqual({ withinOne: false, shortlist: false, quotes: true, enough: false });
    expect(r.raterAgreement).toBeNull();
  });

  it('compares two raters on the same interview and ignores ratings without an AI score', () => {
    const aiMap = new Map([['a', ai('a', 80, { content: 4 })]]);
    const r = buildReport([
      rating('a', 'u1', { content: 4, fluency: 2 }, true),
      rating('a', 'u2', { content: 5, fluency: 5 }, true),
      rating('x', 'u1', { content: 1 }, false),
    ], aiMap, { failures: 0, total: 0 });
    expect(r.raterAgreement).toBe(0.5);
    expect(r.interviews).toBe(1);
    expect(r.raters).toBe(2);
    expect(r.quoteFailureRate).toBeNull();
    expect(r.passes.quotes).toBe(false);
  });

  it('passes once there are enough interviews in close agreement', () => {
    const aiMap = new Map<string, AiScore>(), ratings: Rating[] = [];
    for (let i = 0; i < 25; i++) {
      aiMap.set(`i${i}`, ai(`i${i}`, 70, { content: 4 }));
      ratings.push(rating(`i${i}`, 'u1', { content: 5 }, true));
    }
    const r = buildReport(ratings, aiMap, { failures: 0, total: 150 });
    expect(r.passes).toEqual({ withinOne: true, shortlist: true, quotes: true, enough: true });
  });
});
