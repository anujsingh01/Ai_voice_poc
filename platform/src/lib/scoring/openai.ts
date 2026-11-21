// OpenAI calls for scoring: Fast (one Chat Completions call) or Batch (OpenAI Batch API, half price,
// results within 24 h). Only masked answer text is ever sent. No SDK: plain HTTPS, so every request is visible here.

import { PROMPT_VERSION, responseSchema, systemPrompt, userPrompt, type ScoringInput } from './prompt';

const API = 'https://api.openai.com/v1';
export const scoringModel = () => process.env.OPENAI_MODEL ?? 'gpt-5-mini';

export type Usage = { input_tokens: number; output_tokens: number };
export type ScoreCall = { content: string; usage: Usage; model: string };

/** Cost in rupees. Prices are USD per 1M tokens; confirm them in your OpenAI account and set them in the env. */
export function costInr(usage: Usage, batch: boolean) {
  const inUsd = Number(process.env.OPENAI_PRICE_INPUT_USD_PER_1M ?? 0.25);
  const outUsd = Number(process.env.OPENAI_PRICE_OUTPUT_USD_PER_1M ?? 2.0);
  const rate = Number(process.env.USD_INR ?? 88);
  const usd = (usage.input_tokens * inUsd + usage.output_tokens * outUsd) / 1e6;
  return Math.round(usd * rate * (batch ? 0.5 : 1) * 10000) / 10000;
}

/** The Chat Completions body, shared by Fast calls and Batch lines. */
export function requestBody(input: ScoringInput) {
  return {
    model: scoringModel(),
    reasoning_effort: 'low',
    max_completion_tokens: 8000,
    messages: [
      { role: 'system', content: systemPrompt(input) },
      { role: 'user', content: userPrompt(input) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'interview_score', strict: true, schema: responseSchema(input.dimensions.map(d => d.key)) },
    },
  };
}

async function call(path: string, apiKey: string, init: RequestInit) {
  const r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`OpenAI ${path} ${r.status}: ${(await r.text()).slice(0, 500)}`);
  return r;
}

type Completion = { model: string; choices: { message: { content: string | null; refusal?: string | null }; finish_reason: string }[]; usage: { prompt_tokens: number; completion_tokens: number } };

export function readCompletion(c: Completion): ScoreCall {
  const choice = c.choices[0];
  if (choice.message.refusal) throw new Error('Model refused: ' + choice.message.refusal);
  if (choice.finish_reason !== 'stop' || !choice.message.content) throw new Error(`Incomplete reply (${choice.finish_reason})`);
  return { content: choice.message.content, model: c.model, usage: { input_tokens: c.usage.prompt_tokens, output_tokens: c.usage.completion_tokens } };
}

export async function scoreFast(input: ScoringInput, apiKey: string): Promise<ScoreCall> {
  if (process.env.SCORING_PROVIDER === 'fake') return fakeScore(input);
  const r = await call('/chat/completions', apiKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody(input)),
  });
  return readCompletion((await r.json()) as Completion);
}

/** Submits several interviews as one OpenAI Batch. `custom_id` comes back with each result. */
export async function submitBatch(items: { customId: string; input: ScoringInput }[], apiKey: string) {
  if (process.env.SCORING_PROVIDER === 'fake') return `fake-batch-${Date.now()}`;
  const jsonl = items.map(i => JSON.stringify({ custom_id: i.customId, method: 'POST', url: '/v1/chat/completions', body: requestBody(i.input) })).join('\n');
  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), `scoring-${Date.now()}.jsonl`);
  const file = (await (await call('/files', apiKey, { method: 'POST', body: form })).json()) as { id: string };
  const batch = (await (await call('/batches', apiKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: file.id, endpoint: '/v1/chat/completions', completion_window: '24h', metadata: { prompt_version: PROMPT_VERSION } }),
  })).json()) as { id: string };
  return batch.id;
}

export type BatchResult = { customId: string; result?: ScoreCall; error?: string };

/** null while the batch is still running; otherwise one result per submitted interview. */
export async function collectBatch(batchId: string, apiKey: string, fakeInputs?: Map<string, ScoringInput>): Promise<BatchResult[] | null> {
  if (process.env.SCORING_PROVIDER === 'fake') return [...(fakeInputs ?? new Map()).entries()].map(([customId, input]) => ({ customId, result: fakeScore(input) }));
  const b = (await (await call(`/batches/${batchId}`, apiKey, { method: 'GET' })).json()) as { status: string; output_file_id?: string; error_file_id?: string };
  if (['validating', 'in_progress', 'finalizing', 'cancelling'].includes(b.status)) return null;
  const results: BatchResult[] = [];
  for (const fileId of [b.output_file_id, b.error_file_id].filter(Boolean) as string[]) {
    const text = await (await call(`/files/${fileId}/content`, apiKey, { method: 'GET' })).text();
    for (const line of text.split('\n').filter(Boolean)) {
      const l = JSON.parse(line) as { custom_id: string; response?: { status_code: number; body: Completion }; error?: { message: string } };
      if (l.response?.status_code === 200) {
        try { results.push({ customId: l.custom_id, result: readCompletion(l.response.body) }); }
        catch (e) { results.push({ customId: l.custom_id, error: (e as Error).message }); }
      } else results.push({ customId: l.custom_id, error: l.error?.message ?? `HTTP ${l.response?.status_code}` });
    }
  }
  if (b.status !== 'completed' && !results.length) throw new Error(`Batch ${batchId} ended as ${b.status}`);
  return results;
}

/**
 * Local stand-in used when SCORING_PROVIDER=fake (development and tests, no API key needed).
 * It is NOT an assessment: scores follow answer length and must-mention words, quotes are the answer's
 * first words. Every score it produces is labelled model "fake-local".
 */
export function fakeScore(input: ScoringInput): ScoreCall {
  const answers = input.answers.map(a => {
    const words = a.transcript.split(/\s+/).filter(Boolean);
    const base = words.length >= 40 ? 4 : words.length >= 20 ? 3 : words.length >= 5 ? 2 : 1;
    const covered = a.must_mention.filter(m => a.transcript.toLowerCase().includes(m.toLowerCase()));
    const quote = words.slice(0, Math.min(8, words.length)).join(' ');
    const dims = Object.fromEntries(input.dimensions.map(d => [d.key, {
      score: d.key === 'motivation' && a.type === 'objection' ? null : Math.min(5, base + (covered.length ? 1 : 0)),
      quote: base === 1 ? '' : quote, reason: 'Local stand-in score (no AI used).',
    }]));
    return {
      answer_id: a.answer_id, dimensions: dims, must_mention_covered: covered,
      knockout: a.knockout_rule ? { applies: true, passed: words.length >= 5, quote: base === 1 ? '' : quote } : { applies: false, passed: null, quote: '' },
    };
  });
  const content = JSON.stringify({ answers, summary: 'Local stand-in score for testing; not an AI assessment.', strengths: [], concerns: [] });
  return { content, model: 'fake-local', usage: { input_tokens: Math.round(JSON.stringify(input).length / 3), output_tokens: Math.round(content.length / 3) } };
}
