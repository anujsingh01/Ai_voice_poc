import { sql, withContext, type Tx } from '@/db';
import { fillConsent } from './consent';
import { sha256 } from './crypto';

// Server side of the candidate interview. Candidates have no account: the token in their personal
// link identifies the invitation, and everything runs in that invitation's tenant scope.

export const MIN_ANSWER_SECONDS = 15;

export type Invite = {
  invitation_id: string; tenant_id: string; tenant_name: string; tenant_status: string;
  candidate_name: string; job_title: string; job_status: string; languages: string[];
  status: string; expires_at: Date;
};

export type InviteProblem = 'not_found' | 'revoked' | 'expired' | 'paused' | 'completed';

export async function resolveInvite(token: string): Promise<{ invite: Invite | null; problem: InviteProblem | null }> {
  if (!/^[\w-]{20,64}$/.test(token)) return { invite: null, problem: 'not_found' };
  const [inv] = (await sql`SELECT * FROM invitation_by_token(${sha256(token)})`) as unknown as Invite[];
  if (!inv) return { invite: null, problem: 'not_found' };
  if (inv.status === 'revoked') return { invite: inv, problem: 'revoked' };
  if (inv.status === 'completed') return { invite: inv, problem: 'completed' };
  if (inv.status === 'expired' || new Date(inv.expires_at) < new Date()) return { invite: inv, problem: 'expired' };
  if (inv.tenant_status === 'suspended' || inv.job_status !== 'active') return { invite: inv, problem: 'paused' };
  return { invite: inv, problem: null };
}

export const inInvite = <T,>(inv: Invite, fn: (tx: Tx) => Promise<T>) => withContext({ tenantId: inv.tenant_id }, fn);

/** Everything the candidate app needs to show the current step. */
export async function interviewState(tx: Tx, inv: Invite) {
  const [ctx] = await tx`
    SELECT j.id AS job_id, j.description, j.answer_seconds, c.id AS candidate_id, c.language AS preferred_language,
           l.retention_days, ct.texts AS consent_texts, ct.grievance_contact
    FROM invitations i
    JOIN candidates c ON c.id = i.candidate_id
    JOIN jobs j ON j.id = c.job_id
    JOIN tenant_limits l ON l.tenant_id = i.tenant_id
    LEFT JOIN LATERAL (SELECT texts, grievance_contact FROM consent_texts ORDER BY version DESC LIMIT 1) ct ON true
    WHERE i.id = ${inv.invitation_id}`;
  const consent: Record<string, string> = {};
  for (const l of inv.languages) {
    const t = (ctx.consent_texts as Record<string, string> | null)?.[l];
    if (t) consent[l] = fillConsent(t, { company: inv.tenant_name, days: ctx.retention_days, contact: ctx.grievance_contact });
  }
  const [interview] = await tx`SELECT * FROM interviews WHERE invitation_id = ${inv.invitation_id}`;
  let questions: { position: number; code: string; type: string; text: string; hasAudio: boolean; answered: boolean; attempt: number }[] = [];
  if (interview) {
    questions = (await tx`
      SELECT iq.position, q.code, q.type, q.texts ->> ${interview.language} AS text,
             EXISTS (SELECT 1 FROM question_audio qa JOIN question_bank_versions v ON v.bank_id = qa.bank_id
                     WHERE v.id = q.version_id AND qa.code = q.code AND qa.language = ${interview.language}) AS "hasAudio",
             a.id IS NOT NULL AS answered, coalesce(a.attempt, 0) AS attempt
      FROM interview_questions iq JOIN questions q ON q.id = iq.question_id
      LEFT JOIN answers a ON a.interview_question_id = iq.id
      WHERE iq.interview_id = ${interview.id} ORDER BY iq.position`) as unknown as typeof questions;
  }
  return {
    company: inv.tenant_name, jobTitle: inv.job_title, description: ctx.description as string | null,
    candidateName: inv.candidate_name, languages: inv.languages.filter(l => consent[l]),
    preferredLanguage: ctx.preferred_language as string | null, consent,
    answerSeconds: (interview?.answer_seconds ?? ctx.answer_seconds) as number, minSeconds: MIN_ANSWER_SECONDS,
    interview: interview ? { status: interview.status as string, language: interview.language as string, questions } : null,
  };
}

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * Records consent and draws this candidate's questions from the latest bank version: every knockout
 * question first, then random questions up to the job's count, then random customer objections.
 */
export async function startInterview(tx: Tx, inv: Invite, language: string, ip: string | null, userAgent: string | null) {
  const [existing] = await tx`SELECT id FROM interviews WHERE invitation_id = ${inv.invitation_id}`;
  if (existing) return existing.id as string;
  const [job] = await tx`
    SELECT j.*, c.id AS candidate_id FROM invitations i JOIN candidates c ON c.id = i.candidate_id JOIN jobs j ON j.id = c.job_id
    WHERE i.id = ${inv.invitation_id}`;
  if (!(job.languages as string[]).includes(language)) throw new Error('language');
  const [consent] = await tx`SELECT id, texts FROM consent_texts ORDER BY version DESC LIMIT 1`;
  if (!consent || !(consent.texts as Record<string, string>)[language]) throw new Error('language');
  const [version] = await tx`SELECT id FROM question_bank_versions WHERE bank_id = ${job.bank_id} ORDER BY version DESC LIMIT 1`;
  const [rubric] = await tx`SELECT id FROM rubrics WHERE job_id = ${job.id} ORDER BY version DESC LIMIT 1`;
  const pool = await tx`SELECT id, type, knockout FROM questions WHERE version_id = ${version.id} AND coalesce(texts ->> ${language}, '') <> ''`;

  const knockouts = pool.filter(q => q.type === 'question' && q.knockout);
  const others = shuffle(pool.filter(q => q.type === 'question' && !q.knockout));
  const asked = [...knockouts, ...others].slice(0, Math.max(job.questions_per_interview, knockouts.length));
  const objections = shuffle(pool.filter(q => q.type === 'objection')).slice(0, job.objections_per_interview);
  const plan = [...knockouts, ...shuffle(asked.slice(knockouts.length)), ...objections];

  const [cr] = await tx`
    INSERT INTO consent_records (tenant_id, candidate_id, invitation_id, consent_text_id, language, age_confirmed, ip, user_agent)
    VALUES (${inv.tenant_id}, ${job.candidate_id}, ${inv.invitation_id}, ${consent.id}, ${language}, true, ${ip}, ${userAgent})
    RETURNING id`;
  const [iv] = await tx`
    INSERT INTO interviews (tenant_id, job_id, candidate_id, invitation_id, consent_record_id, bank_version_id, rubric_id, language, answer_seconds)
    VALUES (${inv.tenant_id}, ${job.id}, ${job.candidate_id}, ${inv.invitation_id}, ${cr.id}, ${version.id}, ${rubric.id}, ${language}, ${job.answer_seconds})
    RETURNING id`;
  await tx`INSERT INTO interview_questions ${tx(plan.map((q, i) => ({ tenant_id: inv.tenant_id, interview_id: iv.id, position: i + 1, question_id: q.id })))}`;
  await tx`UPDATE invitations SET status = 'opened' WHERE id = ${inv.invitation_id} AND status = 'pending'`;
  await tx`INSERT INTO audit_log (tenant_id, action, target, details, ip)
           VALUES (${inv.tenant_id}, 'interview.started', ${iv.id}, ${tx.json({ language, questions: plan.length, consent_record: cr.id })}, ${ip})`;
  return iv.id as string;
}
