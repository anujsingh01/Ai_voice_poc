import { Button, Notice, PageHeader, Section, messageFor } from '@/components/ui';
import { requirePlatform } from '@/lib/platform';
import { createPlan } from '../actions';
import { NEW_PLAN, PlanFields } from '../plan-fields';

const ERRORS = { invalid: 'Check the name, prices and limits, and choose at least one language.', name_taken: 'A plan with that name already exists.' };

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePlatform('managePlans');
  const err = messageFor((await searchParams).error, ERRORS);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New plan" back={{ href: '/super/plans', label: 'Plans' }} />
      {err && <Notice>{err}</Notice>}
      <form action={createPlan}>
        <Section title="Plan"><PlanFields plan={NEW_PLAN} /></Section>
        <Button>Create plan</Button>
      </form>
    </div>
  );
}
