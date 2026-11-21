import { inInvite, interviewState, resolveInvite } from '@/lib/interview';
import { allowAttempt } from '@/lib/rate-limit';
import { sha256 } from '@/lib/crypto';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await allowAttempt('cand:' + sha256(token), 600, 3600))) return Response.json({ problem: 'rate_limited' }, { status: 429 });
  const { invite, problem } = await resolveInvite(token);
  if (!invite || problem) {
    // Say it in the language they interviewed in, if they got that far.
    const [iv] = invite ? await inInvite(invite, tx => tx`SELECT language FROM interviews WHERE invitation_id = ${invite.invitation_id}`) : [];
    return Response.json({ problem, company: invite?.tenant_name ?? null, language: iv?.language ?? null },
                         { status: problem === 'not_found' ? 404 : 200 });
  }
  return Response.json(await inInvite(invite, tx => interviewState(tx, invite)), { headers: { 'Cache-Control': 'no-store' } });
}
