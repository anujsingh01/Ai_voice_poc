import { UserPlus } from 'lucide-react';
import { AccessStatus, PersonCell } from '@/components/people';
import { inlineSelectClass, linkActionClass } from '@/components/styles';
import { Button, Card, Field, Notice, PageHeader, Section, Select, messageFor } from '@/components/ui';
import { LinkButton } from '@/components/link-button';
import { inTenant, requireTenant, tenantLimits } from '@/lib/tenant';
import { addUser, changeRole, createUserPasswordLink, removeUser, resetUserTwoFactor } from './actions';

const MESSAGES = { added: 'User added. Create a set-password link and send it to them.', saved: 'Role changed. They’ll see the change at their next sign-in.', removed: 'User removed and signed out.', '2fa_reset': '2-step login turned off. They’ve been signed out and will scan a new QR code at their next sign-in.' };
const ERRORS = {
  invalid: 'Enter a name, a valid email and a role.',
  seats: 'All recruiter seats are in use. Remove someone or ask the platform administrator for more seats. (Reviewers don’t use a seat.)',
  exists: 'That person is already a user here.',
  self: 'You can’t change or remove your own access.',
  not_member: 'That person is not a user here.',
  not_exclusive: 'This person also has access elsewhere; ask the platform administrator to reset their 2-step login.',
};
const ROLES = [
  ['tenant_admin', 'HR admin', 'Everything, including users, questions and settings'],
  ['recruiter', 'Recruiter', 'Import and invite candidates, review and decide'],
  ['reviewer', 'Reviewer', 'Listen and comment only; doesn’t use a seat'],
] as const;

export default async function UsersPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const { msg, error } = await searchParams;
  const { users, limits } = await inTenant(ctx, async tx => ({
    users: await tx`SELECT m.id, m.role, u.id AS user_id, u.name, u.email, u.password_hash IS NOT NULL AS active, u.totp_enabled
                    FROM memberships m JOIN users u ON u.id = m.user_id ORDER BY m.role, u.name`,
    limits: await tenantLimits(tx, ctx.tenant.id),
  }));
  const seatsUsed = users.filter(u => u.role !== 'reviewer').length;
  const edit = ctx.can('manageUsers');
  const note = messageFor(msg, MESSAGES), err = messageFor(error, ERRORS);

  return (
    <>
      <PageHeader title="Team members" description={`${seatsUsed} of ${limits.recruiter_seats} recruiter seats used. Add the people who invite and judge candidates. Reviewers (listen and comment only) don’t use a seat.`} />
      {note && <Notice kind="success">{note}</Notice>}
      {err && <Notice>{err}</Notice>}
      <Card className="mb-6">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><PersonCell name={u.name} email={u.email} you={u.user_id === ctx.user.id} /></td>
                  <td>
                    {edit && u.user_id !== ctx.user.id ? (
                      <form action={changeRole.bind(null, slug, u.id)} className="flex items-center gap-1.5">
                        <select name="role" defaultValue={u.role} className={inlineSelectClass} aria-label={`Role for ${u.name}`}>
                          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button className={linkActionClass()}>Save</button>
                      </form>
                    ) : <span className="text-slate-700">{ROLES.find(r => r[0] === u.role)?.[1]}</span>}
                  </td>
                  <td><AccessStatus active={u.active} twoStep={u.totp_enabled} /></td>
                  <td className="text-right">
                    {edit && u.user_id !== ctx.user.id && (
                      <div className="flex items-center justify-end gap-1">
                        <LinkButton create={createUserPasswordLink.bind(null, slug, u.user_id)} label="Password link" />
                        {u.totp_enabled && <form action={resetUserTwoFactor.bind(null, slug, u.user_id)}><button className={linkActionClass('muted')} title="Lost phone: they set up 2-step login again">Reset 2-step</button></form>}
                        <form action={removeUser.bind(null, slug, u.id)}><button className={linkActionClass('danger')}>Remove</button></form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {edit && (
        <Section title="Add a user" description="New users get a one-time link to set their password. HR admins must also set up 2-step login.">
          <form action={addUser.bind(null, slug)} className="grid items-end gap-x-3 sm:grid-cols-[1fr_1fr_12rem_auto]">
            <Field label="Name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            <Select label="Role" name="role" defaultValue="recruiter">
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Button className="mb-4"><UserPlus className="size-4" /> Add</Button>
          </form>
          <div className="grid gap-3 sm:grid-cols-3">
            {ROLES.map(([v, l, d]) => (
              <div key={v} className="rounded-xl border border-slate-200 p-3"><p className="text-sm font-semibold text-slate-800">{l}</p><p className="mt-0.5 text-xs text-slate-500">{d}</p></div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
