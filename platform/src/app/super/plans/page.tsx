import { Check, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { LinkAsButton, PageHeader } from '@/components/ui';
import { withContext } from '@/db';
import { languageName } from '@/lib/languages';
import { type Plan } from '@/lib/plans';
import { requirePlatform } from '@/lib/platform';

export default async function PlansPage() {
  const { can } = await requirePlatform();
  const { plans, mrr } = await withContext({ superAdmin: true }, async tx => ({
    plans: (await tx`
      SELECT p.*, (SELECT count(*) FROM tenants t WHERE t.plan_id = p.id)::int AS tenants,
             (SELECT count(*) FROM tenants t WHERE t.plan_id = p.id AND t.status = 'active')::int AS paying
      FROM plans p ORDER BY p.archived, p.sort_order, p.price_inr`) as unknown as (Plan & { tenants: number; paying: number })[],
    mrr: (await tx`
      SELECT coalesce(sum(CASE p.billing_period WHEN 'monthly' THEN p.price_inr ELSE p.price_inr / 12.0 END), 0)::float AS v
      FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE t.status = 'active'`)[0].v as number,
  }));
  const live = plans.filter(p => !p.archived);
  // The plan with the most tenants is highlighted as "Most popular".
  const popular = [...live].sort((a, b) => b.tenants - a.tenants)[0];

  return (
    <>
      <PageHeader
        title="Subscription plans"
        description={<>Design what each plan includes and costs. Monthly recurring revenue at list price: <b className="text-slate-700">₹{Math.round(mrr).toLocaleString('en-IN')}</b></>}
        actions={can('managePlans') && <LinkAsButton href="/super/plans/new"><Plus className="size-4" /> New plan</LinkAsButton>}
      />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map(p => {
          const highlight = p.id === popular?.id && p.tenants > 0;
          return (
            <Link key={p.id} href={`/super/plans/${p.id}`}
                  className={`group relative flex flex-col rounded-2xl border bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/60 ${
                    highlight ? 'border-brand-300 ring-1 ring-brand-300' : 'border-slate-200/80'} ${p.archived ? 'opacity-50' : ''}`}>
              {highlight && (
                <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
                  <Sparkles className="size-3" /> Most popular
                </span>
              )}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">{p.name}</h2>
                {p.archived && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Archived</span>}
              </div>
              {p.description && <p className="mt-1 min-h-10 text-sm text-slate-500">{p.description}</p>}
              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight text-slate-900">{p.price_inr === 0 ? 'Free' : `₹${p.price_inr.toLocaleString('en-IN')}`}</span>
                {p.price_inr > 0 && <span className="text-sm text-slate-500">/{p.billing_period === 'monthly' ? 'month' : 'year'}</span>}
              </p>
              <p className="mt-1 text-xs font-medium text-brand-700">{p.trial_days > 0 ? `${p.trial_days}-day free trial` : 'No trial'}</p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm text-slate-700">
                {[
                  `${p.interviews_per_month.toLocaleString('en-IN')} interviews / month`,
                  `${p.recruiter_seats} recruiter seats`,
                  `${p.concurrent_jobs} active jobs`,
                  `₹${p.ai_budget_inr.toLocaleString('en-IN')} AI budget · ${p.scoring_mode === 'fast' ? 'Fast' : 'Batch'} scoring`,
                  `Data kept ${p.retention_days} days`,
                  `${p.languages.length} languages`,
                  ...(p.own_openai_key ? ['Bring your own OpenAI key'] : []),
                ].map(f => (
                  <li key={f} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-500" strokeWidth={2.5} />{f}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-400" title={p.languages.map(languageName).join(', ')}>{p.languages.map(languageName).join(' · ')}</p>
              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs">
                <span className="text-slate-500"><b className="text-slate-800">{p.tenants}</b> compan{p.tenants === 1 ? 'y' : 'ies'} · {p.paying} paying</span>
                <span className="font-medium text-brand-600 opacity-0 transition group-hover:opacity-100">Edit →</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
