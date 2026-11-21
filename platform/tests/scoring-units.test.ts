import { describe, expect, it } from 'vitest';
import { DEFAULT_DIMENSIONS } from '../src/lib/rubric';
import { computeScore, isCloseCall, passesDisagree, quoteFound, type AiReply, type AnswerForScoring } from '../src/lib/scoring/compute';
import { maskTranscript } from '../src/lib/scoring/mask';
import { confidenceScore, fluencyScore } from '../src/lib/scoring/measured';
import { costInr, requestBody } from '../src/lib/scoring/openai';
import { responseSchema } from '../src/lib/scoring/prompt';

describe('masking personal details before scoring', () => {
  it('hides the candidate’s name, phone numbers, emails and long numbers, but keeps short numbers', () => {
    const t = 'Hello my name is Priya Rao, call me on 98765 43210 or +91-91234-56789, mail priya.rao@gmail.com. I have 5 years and visited 20 houses daily. Aadhaar 1234 5678 9012.';
    const m = maskTranscript(t, 'Rao, Priya');
    expect(m).not.toMatch(/Priya|Rao|98765|91234|gmail|1234 5678/);
    expect(m).toContain('[NAME]');
    expect(m).toContain('[EMAIL]');
    expect(m).toContain('[NUMBER]');
    expect(m).toContain('5 years');
    expect(m).toContain('20 houses');
  });

  it('hides a name spoken after “मेरा नाम” and Devanagari digits', () => {
    const m = maskTranscript('नमस्ते, मेरा नाम मीना है। मेरा नंबर ९८७६५४३२१० है।', 'Meena S');
    expect(m).not.toContain('मीना');
    expect(m).not.toContain('९८७६५४३२१०');
  });
});

describe('quote verification', () => {
  const t = 'मैं ग्राहक से कहूंगा कि Prestige का cooker 15 साल तक चलता है, इसमें safety valve और gasket है।';
  it('accepts exact quotes regardless of case and punctuation', () => {
    expect(quoteFound('prestige का cooker 15 साल तक चलता है', t)).toBe(true);
    expect(quoteFound('safety valve और gasket', t)).toBe(true);
  });
  it('tolerates one changed word in a longer quote, but not made-up text', () => {
    expect(quoteFound('Prestige का कुकर 15 साल तक चलता है', t)).toBe(true);
    expect(quoteFound('Prestige offers free replacement for life', t)).toBe(false);
    expect(quoteFound('', t)).toBe(false);
  });
});

describe('measured scores', () => {
  const steady = { duration_seconds: 60, speech_seconds: 50, pause_count: 3, long_pauses: 0, words: 120, words_per_minute: 144, filler_count: 1 };
  it('rewards steady, sufficient speech', () => {
    expect(confidenceScore(steady)).toBe(5);
    expect(fluencyScore(steady, 'hi')).toBe(5);
  });
  it('lowers scores for little speech, long silences, very slow pace and many fillers', () => {
    const hesitant = { duration_seconds: 60, speech_seconds: 12, pause_count: 12, long_pauses: 4, words: 14, words_per_minute: 70, filler_count: 5 };
    expect(confidenceScore(hesitant)).toBeLessThanOrEqual(2);
    expect(fluencyScore(hesitant, 'hi')).toBeLessThanOrEqual(2);
  });
  it('uses a slower comfortable pace for Tamil', () => {
    expect(fluencyScore({ ...steady, words_per_minute: 95 }, 'ta')).toBe(5);
    expect(fluencyScore({ ...steady, words_per_minute: 95 }, 'hi')).toBeLessThan(5);
  });
});

describe('totals are calculated in code', () => {
  const ans = (id: string, weight: number, transcript: string, knockout: string | null = null): AnswerForScoring => ({
    answer_id: id, code: id, type: 'question', category: 'c', weight, question: 'q', good_answer: 'g', average_answer: 'a',
    poor_answer: 'p', must_mention: ['warranty'], knockout_rule: knockout, transcript, low_confidence: false,
    metrics: { duration_seconds: 30, speech_seconds: 25, pause_count: 1, long_pauses: 0, words: 60, words_per_minute: 144, filler_count: 0 },
  });
  const answers = [ans('A1', 1, 'yes I am ready for field work every day', 'Must say yes'), ans('A2', 3, 'I will explain the warranty and safety clearly to the customer')];
  const reply = (s1: number, s2: number, quote2 = 'explain the warranty and safety'): AiReply => ({
    answers: [
      { answer_id: 'A1', dimensions: { content: { score: s1, quote: 'ready for field work', reason: 'r' }, customer_handling: { score: null, quote: '', reason: 'n/a' }, persuasion: { score: null, quote: '', reason: '' }, motivation: { score: s1, quote: 'ready for field work every day', reason: '' } },
        must_mention_covered: [], knockout: { applies: true, passed: true, quote: 'yes I am ready' } },
      { answer_id: 'A2', dimensions: { content: { score: s2, quote: quote2, reason: '' }, customer_handling: { score: s2, quote: quote2, reason: '' }, persuasion: { score: s2, quote: quote2, reason: '' }, motivation: { score: null, quote: '', reason: '' } },
        must_mention_covered: ['Warranty'], knockout: { applies: false, passed: null, quote: '' } },
    ],
    summary: 's', strengths: [], concerns: [],
  });

  it('weights answers by question weight, skips n/a, and maps 1–5 to 0–100 with the rubric weights', () => {
    const c = computeScore(reply(5, 3), answers, DEFAULT_DIMENSIONS, 'en');
    expect(c.dimensions.content.score).toBe(3.5);          // (5×1 + 3×3) / 4
    expect(c.dimensions.customer_handling.score).toBe(3);  // only A2 applies
    expect(c.dimensions.motivation.score).toBe(5);
    expect(c.dimensions.confidence.score).toBe(5);         // measured
    // 25×.625 + 20×.5 + 20×.5 + 15×1 + 10×1 + 10×1 = 70.625 → 70.6
    expect(c.total).toBe(70.6);
    expect(c.quoteFailures).toBe(0);
    expect((c.answers[1] as { must_mention: { covered: string[] } }).must_mention.covered).toEqual(['warranty']);
  });

  it('counts quotes that are not in the transcript', () => {
    expect(computeScore(reply(5, 4, 'offers lifetime free replacement'), answers, DEFAULT_DIMENSIONS, 'en').quoteFailures).toBe(3);
  });

  it('flags failed or unclear knockouts for a recruiter', () => {
    const r = reply(4, 4); r.answers[0].knockout.passed = false;
    expect(computeScore(r, answers, DEFAULT_DIMENSIONS, 'en').flags.map(f => f.type)).toEqual(['knockout']);
  });

  it('rejects a reply that skips an answer', () => {
    const r = reply(4, 4); r.answers.pop();
    expect(() => computeScore(r, answers, DEFAULT_DIMENSIONS, 'en')).toThrow(/missing answers: A2/);
  });

  it('second opinion and close calls', () => {
    expect(isCloseCall(57, 60)).toBe(true);
    expect(isCloseCall(54, 60)).toBe(false);
    const a = computeScore(reply(5, 3), answers, DEFAULT_DIMENSIONS, 'en').dimensions;
    expect(passesDisagree(a, computeScore(reply(4, 3), answers, DEFAULT_DIMENSIONS, 'en').dimensions)).toBe(false);
    expect(passesDisagree(a, computeScore(reply(2, 3), answers, DEFAULT_DIMENSIONS, 'en').dimensions)).toBe(true);
  });
});

describe('OpenAI request', () => {
  it('uses a strict schema: every object lists all its properties as required and allows no extras', () => {
    const walk = (s: Record<string, unknown>): void => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect(new Set(s.required as string[])).toEqual(new Set(Object.keys(s.properties as object)));
        Object.values(s.properties as Record<string, Record<string, unknown>>).forEach(walk);
      }
      if (s.items) walk(s.items as Record<string, unknown>);
      ((s.anyOf as Record<string, unknown>[]) ?? []).forEach(walk);
    };
    walk(responseSchema(['content', 'persuasion']));
  });

  it('sends masked transcripts only, with low reasoning effort and structured output', () => {
    const body = requestBody({ company: 'C', job_title: 'J', language: 'hi', dimensions: [{ key: 'content', label: 'Content' }],
      answers: [{ answer_id: 'A1', type: 'question', category: 'c', weight: 1, question: 'q', good_answer: 'g', average_answer: 'a', poor_answer: 'p', must_mention: [], knockout_rule: null, transcript: 'मेरा नाम [NAME] है' }] });
    expect(body.reasoning_effort).toBe('low');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(body)).toContain('[NAME]');
  });

  it('costs Batch at half price', () => {
    const u = { input_tokens: 5000, output_tokens: 3000 };
    expect(costInr(u, true)).toBeCloseTo(costInr(u, false) / 2, 4);
    expect(costInr(u, false)).toBeGreaterThan(0.4);   // ≈ ₹0.64 at the default prices
    expect(costInr(u, false)).toBeLessThan(1);
  });
});
