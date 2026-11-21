import { getObject } from '@/lib/storage';
import { inInvite, resolveInvite } from '@/lib/interview';

// The recorded question audio for one question of this candidate's interview, in their language.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; position: string }> }) {
  const { token, position } = await params;
  const { invite, problem } = await resolveInvite(token);
  if (!invite || problem) return new Response('Not found', { status: 404 });
  const [audio] = await inInvite(invite, tx => tx`
    SELECT qa.storage_key, qa.mime_type
    FROM interviews iv
    JOIN interview_questions iq ON iq.interview_id = iv.id AND iq.position = ${Number(position) || 0}
    JOIN questions q ON q.id = iq.question_id
    JOIN question_bank_versions v ON v.id = q.version_id
    JOIN question_audio qa ON qa.bank_id = v.bank_id AND qa.code = q.code AND qa.language = iv.language
    WHERE iv.invitation_id = ${invite.invitation_id}`);
  if (!audio) return new Response('Not found', { status: 404 });
  const data = await getObject(audio.storage_key);
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': audio.mime_type, 'Content-Length': String(data.length), 'Cache-Control': 'private, max-age=3600' },
  });
}
