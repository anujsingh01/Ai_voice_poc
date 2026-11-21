import { Check, Minus, ShieldCheck, UserPlus } from 'lucide-react';
import { LinkButton } from '@/components/link-button';
import { AccessStatus, PersonCell } from '@/components/people';
import { inlineSelectClass, linkActionClass } from '@/components/styles';
import { Button, Card, Field, Notice, PageHeader, Section, Select, messageFor } from '@/components/ui';
import { withContext } from '@/db';
import { PLATFORM_CAN, ROLE_INFO, requirePlatform, type PlatformRole } from '@/lib/platform';
import { changeStaffRole, createStaffPasswordLink, inviteStaff, removeStaff, resetStaffTwoFactor } from './actions';

const MESSAGES = { invited: 'Staff member added. Create a set-password link and send it to them; they must set up 2-step login.', saved: 'Role changed. It applies from their next sign-in.', removed: 'Removed from platform staff and signed out.', '2fa_reset': '2-step login turned off. They’ve been signed out and will scan a new QR code at their next sign-in.' };
const ERRORS = { invalid: 'Enter a name, a valid email and a role.', self: 'You can’t change or remove your own access.', last_owner: 'There must always be at least one Owner.',
  tenant_account: 'That email already has company access. Staff need their own separate account.' };
const PERMISSION_LABEL: Record<string, string> = {
  view: 'View companies, plans, usage, audit', manageTenants: 'Create companies, limits, members, suspend', managePlans: 'Design plans',
  assignPlans: 'Change a company’s plan and status', manageWorkers: 'Transcription PCs', manageStaff: 'Platform staff',
};

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { user, can } = await requirePlatform();
  const staff = await withContext({ superAdmin: true }, tx => tx`
    SELECT id, name, email, platform_role, password_hash IS NOT NULL AS active, totp_enabled,
           (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = users.id) AS last_seen
    FROM users WHERE is_super_admin ORDER BY platform_role, name`);
  const { msg, error } = await searchParams;
  const edit = can('manageStaff');
  const roles = Object.keys(ROLE_INFO) as PlatformRole[];

  return (
    <div className="max-w-5xl">
      <PageHeader title="Platform staff" description="People who run the platform. Everyone signs in with a password and a 2-step code, and every change they make is in the audit log." />
      {messageFor(msg, MESSAGES) && <Notice kind="success">{messageFor(msg, MESSAGES)}</Notice>}
      {messageFor(error, ERRORS) && <Notice>{messageFor(error, ERRORS)}</Notice>}

      <Card className="mb-6">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.id}>
                  <td><PersonCell name={s.name} email={s.email} you={s.id === user.id} /></td>
                  <td>
                    {edit && s.id !== user.id ? (
                      <form action={changeStaffRole.bind(null, s.id)} className="flex items-center gap-1.5">
                        <select name="role" defaultValue={s.platform_role} aria-label={`Role for ${s.name}`} className={inlineSelectClass}>
                          {roles.map(r => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
                        </select>
                        <button className={linkActionClass()}>Save</button>
                      </form>
                    ) : <span className="inline-flex items-center gap-1.5 font-medium text-slate-800"><ShieldCheck className="size-4 text-brand-500" />{ROLE_INFO[s.platform_role as PlatformRole].label}</span>}
                  </td>
                  <td>
                    <AccessStatus active={s.active} twoStep={s.totp_enabled} />
                    {s.last_seen && <p className="mt-1 text-xs text-slate-400">seen {new Date(s.last_seen).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
                  </td>
                  <td className="text-right">
                    {edit && s.id !== user.id && (
                      <div className="flex items-center justify-end gap-1">
                        <LinkButton create={createStaffPasswordLink.bind(null, s.id)} label="Password link" />
                        {s.totp_enabled && <form action={resetStaffTwoFactor.bind(null, s.id)}><button className={linkActionClass('muted')} title="Lost phone: they set up 2-step login again">Reset 2-step</button></form>}
                        <form action={removeStaff.bind(null, s.id)}><button className={linkActionClass('danger')}>Remove</button></form>
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
        <Section title="Add a staff member">
          <form action={inviteStaff} className="grid sm:grid-cols-[1fr_1fr_10rem_auto] gap-x-3 items-end">
            <Field label="Name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            <Select label="Role" name="role" defaultValue="support">
              {roles.map(r => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
            </Select>
            <Button className="mb-4"><UserPlus className="size-4" /> Add</Button>
          </form>
        </Section>
      )}

      <Section title="What each role can do" padded={false}>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Permission</th>{roles.map(r => <th key={r} className="text-center">{ROLE_INFO[r].label}</th>)}</tr></thead>
            <tbody>
              {Object.entries(PLATFORM_CAN).map(([perm, allowed]) => (
                <tr key={perm}>
                  <td className="text-slate-700">{PERMISSION_LABEL[perm]}</td>
                  {roles.map(r => <td key={r} className="text-center">{(allowed as readonly string[]).includes(r) ? <Check className="mx-auto size-4 text-emerald-500" strokeWidth={2.5} /> : <Minus className="mx-auto size-4 text-slate-300" />}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
