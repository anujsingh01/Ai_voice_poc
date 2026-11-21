import { z } from 'zod';
import { clientInfo } from '@/lib/auth';
import { sha256 } from '@/lib/crypto';
import { inInvite, interviewState, resolveInvite, startInterview } from '@/lib/interview';
import { allowAttempt } from '@/lib/rate-limit';

const body = z.object({ language: z.string().min(2).max(3), consent: z.literal(true), adult: z.boolean() });

// Candidate accepts the notice and confirms their age; we record consent and draw their questions.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await allowAttempt('cand-start:' + sha256(token), 20, 3600))) return Response.json({ problem: 'rate_limited' }, { status: 429 });
  const { invite, problem } = await resolveInvite(token);
  if (!invite || problem) return Response.json({ problem }, { status: 409 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ problem: 'invalid' }, { status: 400 });
  // Under-18s are stopped before anything is recorded (DPDP Section 9). Nothing about them is stored.
  if (!parsed.data.adult) return Response.json({ problem: 'under_18' }, { status: 403 });
  const { ip, userAgent } = await clientInfo();
  try {
    const state = await inInvite(invite, async tx => {
      await startInterview(tx, invite, parsed.data.language, ip, userAgent);
      return interviewState(tx, invite);
    });
    return Response.json(state);
  } catch (e) {
    if ((e as Error).message === 'language') return Response.json({ problem: 'language' }, { status: 400 });
    throw e;
  }
}
