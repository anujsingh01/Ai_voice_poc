import type { Tx } from '@/db';
import { languageName } from './languages';

/** Reasons a job can't go live yet (empty = ready). Shared with the job page so it can show them. */
export async function activationProblems(tx: Tx, jobId: string): Promise<string[]> {
  const problems: string[] = [];
  const [job] = await tx`SELECT * FROM jobs WHERE id = ${jobId}`;
  if (!job) return ['Job not found.'];
  const [consent] = await tx`SELECT texts FROM consent_texts ORDER BY version DESC LIMIT 1`;
  if (!consent) problems.push('Write the consent notice first (Consent notice page).');
  else {
    const missing = (job.languages as string[]).filter(l => !(consent.texts as Record<string, string>)[l]);
    if (missing.length) problems.push(`The consent notice has no text yet in ${missing.map(languageName).join(', ')}. Add it, or remove that language from the job.`);
  }
  if (!job.bank_id) {
    problems.push('Choose a question bank.');
  } else {
    const [v] = await tx`SELECT id FROM question_bank_versions WHERE bank_id = ${job.bank_id} ORDER BY version DESC LIMIT 1`;
    if (!v) problems.push('The chosen question bank has no questions yet.');
    else {
      const [c] = await tx`
        SELECT count(*) FILTER (WHERE type = 'question')::int AS q, count(*) FILTER (WHERE type = 'objection')::int AS o
        FROM questions WHERE version_id = ${v.id}`;
      if (c.q < job.questions_per_interview) problems.push(`The bank has ${c.q} questions; this job asks ${job.questions_per_interview} per interview.`);
      if (c.o < job.objections_per_interview) problems.push(`The bank has ${c.o} customer objections; this job asks ${job.objections_per_interview}.`);
      const [missing] = await tx`
        SELECT count(*)::int AS n FROM questions q
        WHERE q.version_id = ${v.id} AND EXISTS (SELECT 1 FROM unnest(${job.languages}::text[]) l WHERE coalesce(q.texts ->> l, '') = '')`;
      if (missing.n) problems.push(`${missing.n} questions are missing text in one of this job’s languages.`);
    }
  }
  return problems;
}
