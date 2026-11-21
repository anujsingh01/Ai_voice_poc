import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar, Button, Field, Notice, Section, Select, StatusBadge, messageFor } from '@/components/ui';
import { withContext } from '@/db';
import { formatPrice, type Plan } from '@/lib/plans';
import { requirePlatform } from '@/lib/platform';
import { assignPlan } from '../../plans/actions';
import { addMember, createPasswordLink, removeMember, resetMemberTwoFactor, updateLimits, updateTenant } from '../../actions';
import { LimitsFields, type Limits } from '../../limits-fields';
import { LinkButton } from '@/components/link-button';
import { AccessStatus, PersonCell } from '@/components/people';
import { linkActionClass } from '@/components/styles';

const MESSAGES = {
  created: 'Company created. Next: create a set-password link for the HR admin below and send it to them.',
  saved: 'Saved.',
  plan: 'Plan changed. The company’s limits now match the new plan.',
  member_added: 'Member added. Create a set-password link for them if they are new.',
  '2fa_reset': '2-step login turned off. They’ve been signed out and will scan a new QR code at their next sign-in.',
};
const ERRORS = {
  invalid: 'Some fields are not valid; nothing was saved.',
  member: 'Enter a name, a valid email and a role.',
  staff_account: 'That email belongs to a platform staff account, which can’t also be a company member. Use a separate work email.',
  plan: 'Choose a plan.',
};
const ROLE_NAMES: Record<string, string> = { tenant_admin: 'HR admin', recruiter: 'Recruiter', reviewer: 'Reviewer' };


export default async function TenantPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const { can } = await requirePlatform();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { msg, error } = await searchParams;

  const data = await withContext({ superAdmin: true }, async tx => {
    const [tenant] = await tx`SELECT * FROM tenants WHERE id = ${id}`;
    if (!tenant) return null;
    const [limits] = await tx`SELECT * FROM tenant_limits WHERE tenant_id = ${id}`;
    const members = await tx`
      SELECT m.id, m.role, u.id AS user_id, u.name, u.email, u.password_hash IS NOT NULL AS has_password, u.totp_enabled
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ${id} ORDER BY m.role, u.name`;
    const log = await tx`
      SELECT a.created_at, a.action, a.target, u.email AS actor
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.tenant_id = ${id} ORDER BY a.created_at DESC LIMIT 20`;
    const plans = (await tx`SELECT * FROM plans WHERE NOT archived OR id = ${tenant.plan_id} ORDER BY sort_order, price_inr`) as unknown as Plan[];
    const history = await tx`
      SELECT s.started_at, s.ended_at, s.price_inr, s.billing_period, p.name, u.email AS by
      FROM tenant_subscriptions s JOIN plans p ON p.id = s.plan_id LEFT JOIN users u ON u.id = s.changed_by
      WHERE s.tenant_id = ${id} ORDER BY s.started_at DESC LIMIT 10`;
    const [usage] = await tx`
      SELECT (SELECT count(*) FROM invitations i WHERE i.tenant_id = ${id} AND i.status <> 'revoked'
                AND i.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::int AS invites,
             (SELECT coalesce(sum(cost_inr), 0) FROM usage_ledger u WHERE u.tenant_id = ${id} AND u.billed_to = 'platform'
                AND u.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')::float AS ai_inr`;
    const billingSubs = await tx`SELECT s.*, p.name AS plan_name FROM billing_subscriptions s JOIN plans p ON p.id = s.plan_id
                                 WHERE s.tenant_id = ${id} AND s.status <> 'created' ORDER BY s.created_at DESC LIMIT 5`;
    const payments = await tx`SELECT * FROM billing_payments WHERE tenant_id = ${id} ORDER BY created_at DESC LIMIT 6`;
    return { tenant, limits: limits as unknown as Limits & { custom: boolean }, members, log, plans, history, usage, billingSubs, payments };
  });
  if (!data) notFound();
  const { tenant, limits, members, log, plans, history, usage, billingSubs, payments } = data;
  const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
  const plan = plans.find(p => p.id === tenant.plan_id);
  const note = messageFor(msg, MESSAGES), err = messageFor(error, ERRORS);

  return (
    <div className="max-w-4xl">
      <Link href="/super" className="text-sm font-medium text-slate-500 hover:text-slate-800">← Companies</Link>
      <div className="flex flex-wrap items-center gap-3 mt-3 mb-8">
        <Avatar name={tenant.name} />
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tenant.name}</h1>
        <StatusBadge status={tenant.status} />
        <span className="text-sm text-slate-500">/t/{tenant.slug}</span>
        <Link href={`/t/${tenant.slug}`} className="ml-auto text-sm text-brand-700 hover:underline">View as this company →</Link>
      </div>
      {note && <Notice kind="success">{note}</Notice>}
      {err && <Notice>{err}</Notice>}

      <Section title="Subscription">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-4">
          <span className="text-lg font-semibold text-slate-900">{plan ? plan.name : 'No plan (custom)'}</span>
          {plan && <span className="text-brand-700">{formatPrice(plan)}</span>}
          {limits.custom && <span className="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded px-2 py-0.5">custom limits</span>}
          {tenant.status === 'trial' && tenant.trial_ends_at && <span className="text-sm text-amber-700">trial until {new Date(tenant.trial_ends_at).toLocaleDateString('en-IN')}</span>}
        </div>
        <p className="text-sm text-slate-600 mb-4">
          This month: {usage.invites.toLocaleString('en-IN')} of {limits.interviews_per_month.toLocaleString('en-IN')} interviews ·
          AI cost ₹{usage.ai_inr.toFixed(2)} of ₹{limits.ai_budget_inr.toLocaleString('en-IN')}
        </p>
        {can('assignPlans') && (
          <form action={assignPlan.bind(null, id)} className="flex flex-wrap gap-3 items-end mb-4">
            <div className="grow max-w-sm">
              <Select label="Change plan" name="plan_id" defaultValue={tenant.plan_id ?? ''}>
                <option value="" disabled>Choose…</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name} – {formatPrice(p)}</option>)}
              </Select>
            </div>
            <Button variant="secondary" className="mb-4">Apply plan</Button>
          </form>
        )}
        {history.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-600">Plan history ({history.length})</summary>
            <ul className="mt-2 divide-y divide-slate-100">
              {history.map((h, i) => (
                <li key={i} className="py-1.5 flex flex-wrap gap-x-3 text-slate-600">
                  <span className="font-medium text-slate-800">{h.name}</span>
                  <span>₹{h.price_inr.toLocaleString('en-IN')}/{h.billing_period === 'monthly' ? 'mo' : 'yr'}</span>
                  <span>{new Date(h.started_at).toLocaleDateString('en-IN')} → {h.ended_at ? new Date(h.ended_at).toLocaleDateString('en-IN') : 'now'}</span>
                  <span className="text-slate-400">{h.by}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="Billing" description={tenant.billing_mode === 'razorpay' ? 'Pays online through Razorpay. Payments and failures update the status automatically.' : 'Manual: plan assigned here and invoiced outside the platform.'}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Billed to</dt><dd className="text-slate-900">{tenant.billing_name ?? '—'}{tenant.gstin && <span className="ml-2 font-mono text-xs text-slate-500">GSTIN {tenant.gstin}</span>}</dd></div>
          <div><dt className="text-slate-500">Billing email</dt><dd className="text-slate-900">{tenant.billing_email ?? '—'}</dd></div>
        </dl>
        {tenant.suspended_for_billing && <p className="mt-3 text-sm text-rose-700">Suspended for non-payment: paying on their Billing page reopens it.</p>}
        {billingSubs.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {billingSubs.map(s => (
              <li key={s.id} className="flex flex-wrap gap-x-3 py-1.5 text-slate-600">
                <span className="font-medium text-slate-800">{s.plan_name}</span>
                <span>₹{s.price_inr.toLocaleString('en-IN')}/{s.billing_period === 'monthly' ? 'mo' : 'yr'}</span>
                <span className="capitalize">{s.status}{s.cancel_at_period_end ? ' (not renewing)' : ''}</span>
                <span>{s.current_end ? `paid until ${day(s.current_end)}` : s.starts_at ? `starts ${day(s.starts_at)}` : ''}</span>
                <span className="font-mono text-xs text-slate-400">{s.razorpay_subscription_id}</span>
              </li>
            ))}
          </ul>
        )}
        {payments.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-slate-600">Recent payments ({payments.length})</summary>
            <ul className="mt-2 divide-y divide-slate-100">
              {payments.map(p => (
                <li key={p.id} className="flex flex-wrap gap-x-3 py-1.5 text-slate-600">
                  <span>{day(p.created_at)}</span>
                  <span className="tabular-nums text-slate-900">₹{Number(p.amount_inr).toLocaleString('en-IN')}</span>
                  <span className={p.status === 'captured' ? 'text-emerald-700' : 'text-rose-700'}>{p.status === 'captured' ? 'paid' : `failed${p.error ? `: ${p.error}` : ''}`}</span>
                  {p.invoice_url && <a href={p.invoice_url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">invoice</a>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="Members">
        <div className="-mx-6 -mt-6 mb-6 overflow-x-auto border-b border-slate-100">
          <table className="data-table">
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id}>
                  <td><PersonCell name={m.name} email={m.email} /></td>
                  <td className="text-slate-700">{ROLE_NAMES[m.role]}</td>
                  <td><AccessStatus active={m.has_password} twoStep={m.totp_enabled} /></td>
                  <td className="text-right">
                    {can('manageTenants') && (
                      <div className="flex items-center justify-end gap-1">
                        <LinkButton create={createPasswordLink.bind(null, id, m.user_id)} label="Password link" />
                        {m.totp_enabled && <form action={resetMemberTwoFactor.bind(null, id, m.user_id)}><button className={linkActionClass('muted')} title="Lost phone: they set up 2-step login again">Reset 2-step</button></form>}
                        <form action={removeMember.bind(null, id, m.id)}><button className={linkActionClass('danger')}>Remove</button></form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can('manageTenants') && <form action={addMember.bind(null, id)} className="grid sm:grid-cols-[1fr_1fr_10rem_auto] gap-x-3 items-end">
          <Field label="Name" name="name" required />
          <Field label="Email" name="email" type="email" required />
          <Select label="Role" name="role" defaultValue="recruiter">
            <option value="tenant_admin">HR admin</option>
            <option value="recruiter">Recruiter</option>
            <option value="reviewer">Reviewer</option>
          </Select>
          <Button variant="secondary" className="mb-4">Add member</Button>
        </form>}
      </Section>

      <Section title="Company and status">
        <form action={updateTenant.bind(null, id)}>
          <fieldset disabled={!can('assignPlans')}>
          <Field label="Company name" name="name" defaultValue={tenant.name} required />
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Select label="Status" name="status" defaultValue={tenant.status}>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="suspended">Suspended (read-only, no new interviews, members signed out)</option>
            </Select>
            <Field label="Trial ends (if Trial)" name="trial_ends_at" type="date"
                   defaultValue={tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toISOString().slice(0, 10) : ''} />
          </div>
          {can('assignPlans') && <Button>Save</Button>}
          </fieldset>
        </form>
      </Section>

      <Section title="Limits for this company">
        <p className="text-sm text-slate-500 mb-4">Normally set by the plan. Changing them here marks this company as “custom”, so later plan updates won’t overwrite them; applying a plan again resets them.</p>
        <form action={updateLimits.bind(null, id)}>
          <fieldset disabled={!can('manageTenants')}>
          <LimitsFields limits={limits} />
          {can('manageTenants') && <Button>Save limits</Button>}
          </fieldset>
        </form>
      </Section>

      <Section title="Recent activity">
        {log.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : (
          <ul className="text-sm divide-y divide-slate-100">
            {log.map((a, i) => (
              <li key={i} className="py-2 flex gap-3">
                <span className="text-slate-500 tabular-nums whitespace-nowrap">{new Date(a.created_at).toLocaleString('en-IN')}</span>
                <span className="font-mono text-xs text-slate-800 pt-0.5">{a.action}</span>
                <span className="text-slate-500 truncate">{a.target}</span>
                <span className="ml-auto text-slate-500 truncate">{a.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
