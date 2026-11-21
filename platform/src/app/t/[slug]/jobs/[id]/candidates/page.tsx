import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LinkButton } from '@/components/link-button';
import { Send, UserPlus, Users } from 'lucide-react';
import { linkActionClass } from '@/components/styles';
import { Avatar, Button, Card, EmptyState, Field, Notice, Section, Select, messageFor } from '@/components/ui';
import { JobHeader } from '../job-header';
import { firstName } from '@/lib/candidates';
import { languageName } from '@/lib/languages';
import { inTenant, requireTenant } from '@/lib/tenant';
import { addCandidate, inviteAllNew, inviteOne, revokeInvite } from './actions';
import { ImportForm } from './import-form';

const ERRORS = {
  candidate: 'Enter a name and a valid Indian mobile number or email.',
  duplicate: 'A candidate with that phone or email is already on this job.',
  closed: 'This job is closed.',
  job_inactive: 'Activate the job before inviting candidates.',
  limit: 'This month’s interview limit is reached. New invites are blocked until next month or until the platform administrator raises the limit.',
  none: 'Everyone on this job has already been invited.',
};
const INVITE_LABEL: Record<string, string> = {
  pending: 'Sent, not opened', opened: 'Opened, not finished', completed: 'Finished', expired: 'Expired', revoked: 'Cancelled',
};
const INVITE_STYLE: Record<string, string> = {
  pending: 'bg-brand-50 text-brand-700 ring-brand-600/20', opened: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', expired: 'bg-slate-50 text-slate-600 ring-slate-500/20',
  revoked: 'bg-slate-50 text-slate-500 ring-slate-500/20',
};

export default async function CandidatesPage({ params, searchParams }: {
  params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ msg?: string; error?: string; n?: string }>;
}) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant(slug);
  const data = await inTenant(ctx, async tx => {
    const [job] = await tx`SELECT id, title, status, location, languages FROM jobs WHERE id = ${id}`;
    if (!job) return null;
    const candidates = await tx`
      SELECT c.*, i.status AS invite_status, i.expires_at, iv.id AS interview_id, iv.status AS interview_status,
             (SELECT count(*) FROM interview_questions iq JOIN answers a ON a.interview_question_id = iq.id WHERE iq.interview_id = iv.id)::int AS answered,
             (SELECT count(*) FROM interview_questions iq WHERE iq.interview_id = iv.id)::int AS questions
      FROM candidates c
      LEFT JOIN interviews iv ON iv.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT status, expires_at FROM invitations WHERE candidate_id = c.id ORDER BY created_at DESC LIMIT 1) i ON true
      WHERE c.job_id = ${id} ORDER BY c.created_at DESC LIMIT 1000`;
    return { job, candidates };
  });
  if (!data) notFound();
  const { job, candidates } = data;
  const { msg, error, n } = await searchParams;
  const note = msg === 'added' ? 'Candidate added.' : msg === 'invited' ? `Invited ${Number(n) || 0} candidates. Messages are queued on the Messages page.` : null;
  const err = messageFor(error, ERRORS);
  const edit = ctx.can('manageCandidates');
  const notInvited = candidates.filter(c => !c.invite_status).length;
  const statusOf = (c: (typeof candidates)[number]) =>
    c.invite_status && ['pending', 'opened'].includes(c.invite_status) && new Date(c.expires_at) < new Date() ? 'expired' : c.invite_status;

  const counts = {
    total: candidates.length,
    invited: candidates.filter(c => c.invite_status).length,
    done: candidates.filter(c => c.interview_status === 'completed').length,
  };
  return (
    <>
      <JobHeader slug={slug} job={job as never} tab="candidates" counts={{ candidates: counts.total }}
                  description={<>{counts.total} added · {counts.invited} sent a link · {counts.done} finished. Add people below, then press <b className="text-slate-700">Invite</b> to send each one their own interview link by SMS or email (or copy it to WhatsApp).</>}
                  actions={edit && job.status === 'active' && notInvited > 0 && (
                    <form action={inviteAllNew.bind(null, slug, id)}><Button><Send className="size-4" /> Send links to {notInvited} new {notInvited === 1 ? 'candidate' : 'candidates'}</Button></form>
                  )} />
      {note && <Notice kind="success">{note}</Notice>}
      {err && <Notice>{err}</Notice>}
      {edit && job.status !== 'active' && <Notice kind="info">This job isn’t live yet. You can add candidates now and send their links once it goes live (Settings & scoring tab).</Notice>}

      {candidates.length === 0 ? <div className="mb-6"><EmptyState icon={<Users className="size-5" />}>No candidates yet. Add one below, or upload a list from Excel.</EmptyState></div> : (
        <Card className="mb-6">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Candidate</th><th>Contact</th><th>Language</th><th>Interview link</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {candidates.map(c => {
                  const s = statusOf(c);
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} size="sm" />
                          <div>
                            {c.interview_id ? <Link href={`/t/${slug}/interviews/${c.interview_id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.name}</Link>
                                            : <span className="font-medium text-slate-900">{c.name}</span>}
                            {c.interview_id && <p className="text-xs text-slate-500">{c.interview_status === 'completed' ? 'Interview complete' : `${c.answered} of ${c.questions} answered`}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="text-slate-600">{c.phone && <div className="tabular-nums">{c.phone}</div>}{c.email && <div className="text-xs text-slate-500">{c.email}</div>}</td>
                      <td className="text-slate-600">{c.language ? languageName(c.language) : <span className="text-slate-400">Candidate chooses</span>}</td>
                      <td>
                        {s ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${INVITE_STYLE[s]}`}>{INVITE_LABEL[s] ?? s}</span> : <span className="text-xs text-slate-400">Not sent yet</span>}
                        {(s === 'pending' || s === 'opened') && <p className="mt-1 text-xs text-slate-500">until {new Date(c.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>}
                      </td>
                      <td className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {edit && job.status === 'active' && s !== 'completed' && (
                            <LinkButton create={inviteOne.bind(null, slug, id, c.id)} label={s ? 'Send new link' : 'Invite'}
                                        whatsapp={c.phone ? { phone: c.phone, message: `Hi ${firstName(c.name)}, ${ctx.tenant.name} invites you to a 15-minute voice interview for ${job.title}. Open this link on your phone (in Chrome or Safari): {link}` } : undefined} />
                          )}
                          {edit && (s === 'pending' || s === 'opened') && (
                            <form action={revokeInvite.bind(null, slug, id, c.id)}>
                              <button className={linkActionClass('danger')} title="The link stops working">Cancel link</button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {edit && job.status !== 'closed' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Upload a list (CSV from Excel)" description={<>In Excel, use File › Save as › CSV. First row: <code className="rounded bg-slate-100 px-1 text-xs">name, phone, email, language</code>. Phone or email is needed; Indian mobile numbers in any format. Language codes: {(job.languages as string[]).join(', ')}, or blank to let the candidate choose.</>}>
            <ImportForm slug={slug} jobId={id} />
          </Section>
          <Section title="Add one candidate">
            <form action={addCandidate.bind(null, slug, id)}>
              <Field label="Name" name="name" required />
              <div className="grid gap-x-3 sm:grid-cols-2">
                <Field label="Mobile number" name="phone" inputMode="tel" placeholder="98765 43210" />
                <Field label="Email" name="email" type="email" />
              </div>
              <Select label="Language" name="language" defaultValue="">
                <option value="">Candidate chooses</option>
                {(job.languages as string[]).map(l => <option key={l} value={l}>{languageName(l)}</option>)}
              </Select>
              <Button variant="secondary"><UserPlus className="size-4" /> Add candidate</Button>
            </form>
          </Section>
        </div>
      )}
    </>
  );
}
