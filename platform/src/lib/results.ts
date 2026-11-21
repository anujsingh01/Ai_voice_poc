import type { Tx } from '@/db';

// Ranked results for a job: the recruiter's override wins over the AI score; the latest decision applies.

export type ResultFilter = { view: 'all' | 'review' | 'undecided' | 'shortlist' | 'hold' | 'reject'; language?: string; min?: number };

export const VIEWS: { key: ResultFilter['view']; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'review', label: 'Flagged' }, { key: 'undecided', label: 'Undecided' },
  { key: 'shortlist', label: 'Shortlisted' }, { key: 'hold', label: 'On hold' }, { key: 'reject', label: 'Rejected' },
];

export function readFilter(sp: Record<string, string | undefined>): ResultFilter {
  const view = VIEWS.some(v => v.key === sp.view) ? (sp.view as ResultFilter['view']) : 'all';
  const min = Number(sp.min);
  return { view, language: sp.lang && /^[a-z]{2,3}$/.test(sp.lang) ? sp.lang : undefined, min: Number.isFinite(min) && min > 0 ? Math.min(100, min) : undefined };
}

export type ResultRow = {
  interview_id: string; candidate_id: string; name: string; phone: string | null; email: string | null; language: string;
  completed_at: Date; score_status: string; ai_score: number | null; override_score: number | null; score: number | null;
  flags: { type: string }[]; decision: string | null; decision_reason: string | null; comments: number;
};

export async function jobResults(tx: Tx, jobId: string, f: ResultFilter) {
  const rows = (await tx`
    SELECT iv.id AS interview_id, c.id AS candidate_id, c.name, c.phone, c.email, iv.language, iv.completed_at, iv.score_status,
           iv.final_score::float AS ai_score, o.new_score::float AS override_score,
           coalesce(o.new_score, iv.final_score)::float AS score, iv.score_flags AS flags,
           d.decision, d.reason AS decision_reason,
           (SELECT count(*) FROM comments cm WHERE cm.interview_id = iv.id)::int AS comments
    FROM interviews iv JOIN candidates c ON c.id = iv.candidate_id
    LEFT JOIN LATERAL (SELECT new_score FROM score_overrides WHERE interview_id = iv.id ORDER BY id DESC LIMIT 1) o ON true
    LEFT JOIN LATERAL (SELECT decision, reason FROM decisions WHERE interview_id = iv.id ORDER BY id DESC LIMIT 1) d ON true
    WHERE iv.job_id = ${jobId} AND iv.status = 'completed'
      AND (${f.language ?? null}::text IS NULL OR iv.language = ${f.language ?? null})
      AND (${f.min ?? null}::numeric IS NULL OR coalesce(o.new_score, iv.final_score) >= ${f.min ?? null})
      AND CASE ${f.view}
            WHEN 'review' THEN iv.score_status = 'needs_review' AND d.decision IS NULL
            WHEN 'undecided' THEN d.decision IS NULL
            WHEN 'all' THEN true
            ELSE d.decision::text = ${f.view}
          END
    ORDER BY coalesce(o.new_score, iv.final_score) DESC NULLS LAST, iv.completed_at
    LIMIT 2000`) as unknown as ResultRow[];
  const [counts] = await tx`
    SELECT count(*)::int AS all,
           count(*) FILTER (WHERE iv.score_status = 'needs_review' AND d.decision IS NULL)::int AS review,
           count(*) FILTER (WHERE d.decision IS NULL)::int AS undecided,
           count(*) FILTER (WHERE d.decision = 'shortlist')::int AS shortlist,
           count(*) FILTER (WHERE d.decision = 'hold')::int AS hold,
           count(*) FILTER (WHERE d.decision = 'reject')::int AS reject
    FROM interviews iv
    LEFT JOIN LATERAL (SELECT decision FROM decisions WHERE interview_id = iv.id ORDER BY id DESC LIMIT 1) d ON true
    WHERE iv.job_id = ${jobId} AND iv.status = 'completed'`;
  return { rows, counts: counts as Record<ResultFilter['view'], number> };
}

/** Plain-language names for the reasons an interview is flagged for a person to check. */
export const FLAG_LABEL: Record<string, string> = {
  knockout: 'Must-pass answer not met', low_transcript_confidence: 'Unclear audio', quote_unverified: 'AI quote not found in answer',
  passes_disagree: 'Two AI checks disagree', close_call: 'Close to the cut-off',
};

/** Finished, scored interviews nobody has decided on yet, across all jobs: flagged ones first, then highest score. */
export async function awaitingDecision(tx: Tx, limit = 500) {
  return (await tx`
    SELECT iv.id, iv.language, iv.completed_at, iv.score_status, iv.score_flags AS flags,
           coalesce(o.new_score, iv.final_score)::float AS score, c.name, j.id AS job_id, j.title AS job, r.shortlist_cutoff
    FROM interviews iv JOIN candidates c ON c.id = iv.candidate_id JOIN jobs j ON j.id = iv.job_id JOIN rubrics r ON r.id = iv.rubric_id
    LEFT JOIN LATERAL (SELECT new_score FROM score_overrides WHERE interview_id = iv.id ORDER BY id DESC LIMIT 1) o ON true
    WHERE iv.status = 'completed' AND iv.final_score IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.interview_id = iv.id)
    ORDER BY (iv.score_status = 'needs_review') DESC, coalesce(o.new_score, iv.final_score) DESC, iv.completed_at
    LIMIT ${limit}`) as unknown as {
      id: string; language: string; completed_at: Date; score_status: string; flags: { type: string; detail: string }[];
      score: number; name: string; job_id: string; job: string; shortlist_cutoff: number;
    }[];
}

export async function awaitingDecisionCount(tx: Tx) {
  const [r] = await tx`SELECT count(*)::int AS n FROM interviews iv WHERE iv.status = 'completed' AND iv.final_score IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.interview_id = iv.id)`;
  return r.n as number;
}

/** CSV cell: quoted, and neutralised so a spreadsheet never runs it as a formula. */
export function csvCell(v: unknown) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Phone numbers are validated as +91XXXXXXXXXX on the way in, so the leading + is safe to keep. */
export const csvPhone = (p: string | null) => (p && /^\+91[6-9]\d{9}$/.test(p) ? `"${p}"` : csvCell(p));

export const DECISION_STYLE: Record<string, [string, string]> = {
  shortlist: ['Shortlisted', 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'],
  hold: ['On hold', 'bg-amber-50 text-amber-800 ring-amber-600/20'],
  reject: ['Rejected', 'bg-slate-100 text-slate-600 ring-slate-500/20'],
};
