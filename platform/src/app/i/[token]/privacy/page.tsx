import type { Metadata } from 'next';
import { sql, withContext } from '@/db';
import { sha256 } from '@/lib/crypto';
import { submitRequest } from './actions';

export const metadata: Metadata = { title: 'Your data and privacy', referrer: 'no-referrer' };

const MESSAGES: Record<string, string> = {
  access: 'Request received. The company will send you a copy of your data.',
  correction: 'Request received. The company will correct your data and confirm.',
  deletion: 'Request received. The company will delete your data and confirm.',
  withdraw: 'Consent withdrawn. Your interview has stopped and your data will be deleted shortly.',
  complaint: 'Complaint received. The grievance officer will respond.',
};
const ERRORS: Record<string, string> = {
  invalid: 'This link isn’t valid.', rate: 'Too many requests. Please try again later.', details: 'Please describe what you need.',
};

// Candidate's own privacy page (DPDP Sections 11–13): what is held, and one-tap requests.
export default async function PrivacyPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { token } = await params;
  const { msg, error } = await searchParams;
  const [inv] = /^[\w-]{20,64}$/.test(token) ? await sql`SELECT * FROM invitation_by_token(${sha256(token)})` : [];
  const data = inv ? await withContext({ tenantId: inv.tenant_id }, async tx => {
    const [c] = await tx`
      SELECT c.name, c.phone, c.email, c.delete_after, ct.grievance_contact,
             (SELECT count(*) FROM answers a JOIN interview_questions iq ON iq.id = a.interview_question_id JOIN interviews iv ON iv.id = iq.interview_id WHERE iv.candidate_id = c.id)::int AS answers,
             (SELECT min(accepted_at) FROM consent_records cr WHERE cr.candidate_id = c.id) AS consented,
             (SELECT max(withdrawn_at) FROM consent_records cr WHERE cr.candidate_id = c.id) AS withdrawn
      FROM invitations i JOIN candidates c ON c.id = i.candidate_id
      LEFT JOIN LATERAL (SELECT grievance_contact FROM consent_texts ORDER BY version DESC LIMIT 1) ct ON true
      WHERE i.id = ${inv.invitation_id}`;
    return c;
  }) : null;

  const shell = (children: React.ReactNode) => (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        {inv && <p className="mb-1 text-sm font-semibold text-brand-700">{inv.tenant_name}</p>}
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900">Your data and privacy</h1>
        {children}
      </div>
    </main>
  );
  if (!data) return shell(<p className="rounded-2xl bg-white p-6 text-slate-600 ring-1 ring-slate-200">There is no data linked to this link. It may already have been deleted.</p>);

  const card = 'rounded-2xl bg-white p-5 ring-1 ring-slate-200 mb-4';
  const button = 'w-full rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.98]';
  return shell(
    <>
      {msg && MESSAGES[msg] && <p role="status" className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">{MESSAGES[msg]}</p>}
      {error && ERRORS[error] && <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">{ERRORS[error]}</p>}
      <section className={card}>
        <h2 className="mb-3 font-semibold text-slate-900">What {inv.tenant_name} holds about you</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-slate-500">Name</dt><dd>{data.name}</dd>
          <dt className="text-slate-500">Contact</dt><dd>{[data.phone, data.email].filter(Boolean).join(' · ')}</dd>
          <dt className="text-slate-500">Recorded answers</dt><dd>{data.answers} (audio and text)</dd>
          <dt className="text-slate-500">Consent given</dt><dd>{data.consented ? new Date(data.consented).toLocaleDateString('en-IN') : 'Not yet'}{data.withdrawn && ` · withdrawn ${new Date(data.withdrawn).toLocaleDateString('en-IN')}`}</dd>
          <dt className="text-slate-500">Deleted on</dt><dd>{data.delete_after ? new Date(data.delete_after).toLocaleDateString('en-IN') : 'After your interview, per the notice'}</dd>
        </dl>
      </section>

      {!data.withdrawn && (
        <section className={card}>
          <h2 className="font-semibold text-slate-900">Withdraw consent</h2>
          <p className="mt-1 mb-3 text-sm text-slate-600">Stops your interview and deletes your recordings and results. This can’t be undone.</p>
          <form action={submitRequest.bind(null, token)}>
            <input type="hidden" name="kind" value="withdraw" />
            <button className={`${button} bg-rose-600 text-white`}>Withdraw consent and delete my data</button>
          </form>
        </section>
      )}

      <section className={card}>
        <h2 className="font-semibold text-slate-900">Make a request</h2>
        <form action={submitRequest.bind(null, token)} className="mt-3 space-y-3">
          <select name="kind" defaultValue="access" aria-label="Request" className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">
            <option value="access">Send me a copy of my data</option>
            <option value="correction">Correct something about me</option>
            <option value="deletion">Delete my data</option>
            <option value="complaint">Make a complaint</option>
          </select>
          <textarea name="details" rows={3} maxLength={2000} placeholder="Details (needed for corrections and complaints)" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button className={`${button} bg-brand-600 text-white`}>Send request</button>
        </form>
        <p className="mt-3 text-xs text-slate-500">The company responds within 30 days. Grievance contact: {data.grievance_contact ?? '—'}. If you are not satisfied, you may complain to the Data Protection Board of India.</p>
      </section>
    </>
  );
}
