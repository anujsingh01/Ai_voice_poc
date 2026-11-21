import { clientInfo } from '@/lib/auth';
import { inInvite, resolveInvite } from '@/lib/interview';

// Candidate finished: only allowed once every question has an uploaded answer.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { invite, problem } = await resolveInvite(token);
  if (problem === 'completed') return Response.json({ ok: true });
  if (!invite || problem) return Response.json({ problem }, { status: 409 });
  const { ip } = await clientInfo();
  const result = await inInvite(invite, async tx => {
    const [iv] = await tx`
      SELECT iv.id, count(iq.id)::int AS questions, count(a.id)::int AS answers
      FROM interviews iv JOIN interview_questions iq ON iq.interview_id = iv.id
      LEFT JOIN answers a ON a.interview_question_id = iq.id
      WHERE iv.invitation_id = ${invite.invitation_id} GROUP BY iv.id`;
    if (!iv) return 'not_started';
    if (iv.answers < iv.questions) return 'unanswered';
    await tx`UPDATE interviews SET status = 'completed', completed_at = now() WHERE id = ${iv.id}`;
    await tx`UPDATE invitations SET status = 'completed' WHERE id = ${invite.invitation_id}`;
    // Retention clock starts now: data is deleted after the tenant's retention period (48-hour notice first).
    await tx`UPDATE candidates c SET delete_after = now() + make_interval(days => l.retention_days)
             FROM tenant_limits l, invitations i WHERE i.id = ${invite.invitation_id} AND c.id = i.candidate_id AND l.tenant_id = c.tenant_id`;
    await tx`INSERT INTO audit_log (tenant_id, action, target, ip) VALUES (${invite.tenant_id}, 'interview.completed', ${iv.id}, ${ip})`;
    return 'ok';
  });
  return result === 'ok' ? Response.json({ ok: true }) : Response.json({ problem: result }, { status: 409 });
}
