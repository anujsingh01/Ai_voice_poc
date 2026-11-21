import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Notice, PageHeader, Section, StatusBadge, messageFor } from '@/components/ui';
import { withContext } from '@/db';
import { formatPrice, type Plan } from '@/lib/plans';
import { requirePlatform } from '@/lib/platform';
import { setPlanArchived, updatePlan } from '../actions';
import { PlanFields } from '../plan-fields';

const ERRORS = { invalid: 'Check the name, prices and limits, and choose at least one language.', name_taken: 'A plan with that name already exists.' };

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; n?: string }> }) {
  const { can } = await requirePlatform();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withContext({ superAdmin: true }, async tx => {
    const [plan] = (await tx`SELECT * FROM plans WHERE id = ${id}`) as unknown as Plan[];
    if (!plan) return null;
    const tenants = await tx`SELECT t.id, t.name, t.status, l.custom FROM tenants t JOIN tenant_limits l ON l.tenant_id = t.id WHERE t.plan_id = ${id} ORDER BY t.name`;
    return { plan, tenants };
  });
  if (!data) notFound();
  const { plan, tenants } = data;
  const { msg, error, n } = await searchParams;
  const note = msg === 'created' ? 'Plan created. Assign it to companies from their page.' : msg === 'saved' ? 'Saved. Companies keep their current limits until you apply the plan to them.'
    : msg === 'applied' ? `Saved and applied to ${Number(n) || 0} companies.` : msg === 'archived' ? 'Archived: it can’t be chosen for new companies; existing companies keep it.' : msg === 'restored' ? 'Restored.' : null;
  const edit = can('managePlans');
  const following = tenants.filter(t => !t.custom).length;

  return (
    <div className="max-w-4xl">
      <PageHeader title={plan.name} back={{ href: '/super/plans', label: 'Plans' }}>
        <span className="text-sm text-slate-500">{formatPrice(plan)}</span>
        {plan.archived && <span className="text-xs text-slate-500 border rounded px-2 py-0.5">archived</span>}
      </PageHeader>
      {note && <Notice kind="success">{note}</Notice>}
      {messageFor(error, ERRORS) && <Notice>{messageFor(error, ERRORS)}</Notice>}

      <form action={updatePlan.bind(null, id)}>
        <Section title="Plan">
          <PlanFields plan={plan} disabled={!edit} />
          {edit && (
            <>
              {tenants.length > 0 && (
                <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm text-slate-700">
                  <input type="checkbox" name="apply" className="mt-0.5 size-4 accent-brand-600" />
                  <span>Also apply these limits now to the {following} compan{following === 1 ? 'y' : 'ies'} on this plan
                    {tenants.length > following && ` (${tenants.length - following} with custom limits are left as they are)`}.</span>
                </label>
              )}
              <Button>Save plan</Button>
            </>
          )}
        </Section>
      </form>

      <Section title={`Companies on this plan (${tenants.length})`}>
        {tenants.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
          <ul className="text-sm divide-y divide-slate-100">
            {tenants.map(t => (
              <li key={t.id} className="py-2 flex items-center gap-3">
                <Link href={`/super/tenants/${t.id}`} className="text-brand-700 hover:underline">{t.name}</Link>
                <StatusBadge status={t.status} />
                {t.custom && <span className="text-xs text-amber-700">custom limits</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {edit && (
        <form action={setPlanArchived.bind(null, id, !plan.archived)}>
          <Button variant="secondary">{plan.archived ? 'Restore plan' : 'Archive plan'}</Button>
        </form>
      )}
    </div>
  );
}
