import { audit } from '@/lib/audit';
import { clientInfo } from '@/lib/auth';
import { inTenant, loadTenant } from '@/lib/tenant';

// For an access request: everything held about the candidate, as JSON the company can send them.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await loadTenant(slug);
  if (!ctx.can('manageSetup')) return new Response('Forbidden', { status: 403 });
  const { ip } = await clientInfo();
  const data = await inTenant(ctx, async tx => {
    const [r] = await tx`SELECT candidate_id FROM rights_requests WHERE id = ${Number(id) || 0}`;
    if (!r?.candidate_id) return null;
    const [candidate] = await tx`SELECT name, phone, email, language, created_at FROM candidates WHERE id = ${r.candidate_id}`;
    const consent = await tx`SELECT cr.language, cr.accepted_at, cr.withdrawn_at, ct.version FROM consent_records cr JOIN consent_texts ct ON ct.id = cr.consent_text_id WHERE cr.candidate_id = ${r.candidate_id}`;
    const interviews = await tx`
      SELECT iv.id, iv.language, iv.started_at, iv.completed_at, iv.final_score,
             (SELECT json_agg(json_build_object('question', q.texts ->> iv.language, 'transcript', a.transcript, 'recorded_seconds', a.duration_ms / 1000) ORDER BY iq.position)
                FROM interview_questions iq JOIN questions q ON q.id = iq.question_id LEFT JOIN answers a ON a.interview_question_id = iq.id
                WHERE iq.interview_id = iv.id) AS answers,
             (SELECT json_agg(json_build_object('decision', d.decision, 'reason', d.reason, 'at', d.created_at)) FROM decisions d WHERE d.interview_id = iv.id) AS decisions
      FROM interviews iv WHERE iv.candidate_id = ${r.candidate_id}`;
    await audit(tx, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: 'rights.access_exported', target: id, ip });
    return { company: ctx.tenant.name, generated_at: new Date().toISOString(), candidate, consent, interviews };
  });
  if (!data) return new Response('Not found or already deleted', { status: 404 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="data-request-${id}.json"`, 'Cache-Control': 'no-store' },
  });
}
