import { Gauge, IndianRupee, KeyRound, Sparkles, Zap } from 'lucide-react';
import { linkActionClass } from '@/components/styles';
import { Button, Field, Notice, PageHeader, Section, StatCard, messageFor } from '@/components/ui';
import { inTenant, requireTenant, tenantLimits } from '@/lib/tenant';
import { removeOpenAiKey, saveOpenAiKey } from './actions';

const MESSAGES = { saved: 'Key saved (encrypted). Scoring now uses your OpenAI account.', removed: 'Key removed. Scoring uses the platform’s account and your monthly AI budget.' };
const ERRORS = { key: 'That doesn’t look like an OpenAI API key (it starts with “sk-”).', not_allowed: 'Using your own key isn’t enabled for your account. Ask the platform administrator.' };
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default async function AiPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const { limits, usage, secret, statuses } = await inTenant(ctx, async tx => ({
    limits: await tenantLimits(tx, ctx.tenant.id),
    usage: (await tx`
      SELECT coalesce(sum(cost_inr) FILTER (WHERE billed_to = 'platform'), 0)::float AS platform_inr,
             coalesce(sum(cost_inr) FILTER (WHERE billed_to = 'tenant'), 0)::float AS own_inr,
             count(DISTINCT interview_id)::int AS interviews, count(*)::int AS calls,
             coalesce(sum(input_tokens), 0)::int AS input_tokens, coalesce(sum(output_tokens), 0)::int AS output_tokens
      FROM usage_ledger
      WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`)[0],
    secret: (await tx`SELECT openai_key_hint, updated_at FROM tenant_secrets`)[0],
    statuses: await tx`SELECT score_status, count(*)::int AS n FROM interviews WHERE status = 'completed' GROUP BY score_status`,
  }));
  const { msg, error } = await searchParams;
  const used = limits.ai_budget_inr ? usage.platform_inr / limits.ai_budget_inr : 0;
  const ownKeyActive = limits.own_openai_key && !!secret;
  const paused = statuses.find(s => s.score_status === 'paused_budget')?.n ?? 0;

  return (
    <>
      <PageHeader title="AI usage & cost" description="Speech-to-text runs on your own PCs at no per-use cost. Only scoring uses a paid AI service, on masked text." />
      {messageFor(msg, MESSAGES) && <Notice kind="success">{messageFor(msg, MESSAGES)}</Notice>}
      {messageFor(error, ERRORS) && <Notice>{messageFor(error, ERRORS)}</Notice>}
      {paused > 0 && <Notice>{paused} interview{paused === 1 ? ' is' : 's are'} waiting because this month’s AI budget is used up. Transcripts are kept; they are scored once the budget is raised or the month resets.</Notice>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Interviews scored" value={usage.interviews} sub="This month" icon={<Sparkles className="size-4.5" />} />
        <StatCard label={ownKeyActive ? 'Billed to your OpenAI' : 'AI cost this month'} value={inr(ownKeyActive ? usage.own_inr : usage.platform_inr)} icon={<IndianRupee className="size-4.5" />} tone="emerald"
                  sub={ownKeyActive ? 'Using your own key' : `of ${inr(limits.ai_budget_inr)} budget`} progress={ownKeyActive ? undefined : used} />
        <StatCard label="Average per interview" value={usage.interviews ? inr((usage.platform_inr + usage.own_inr) / usage.interviews) : '—'} icon={<Gauge className="size-4.5" />} tone="sky" sub="Including second opinions" />
        <StatCard label="Scoring mode" value={limits.scoring_mode === 'batch' || used >= 0.9 ? 'Batch' : 'Fast'} icon={<Zap className="size-4.5" />} tone="amber"
                  sub={limits.scoring_mode === 'batch' || used >= 0.9 ? 'Within 24 h at half price' : 'Results in minutes'} />
      </div>

      <Section title="How the budget works">
        <ol className="grid gap-3 text-sm sm:grid-cols-3">
          {[['Up to 90%', 'Scoring runs in your plan’s mode.', 'bg-brand-50 text-brand-700'], ['From 90%', 'Switches to Batch automatically: results within 24 h, half the cost.', 'bg-amber-50 text-amber-800'], ['At 100%', 'Scoring pauses. Transcripts are kept and scored when the budget is raised or the month resets.', 'bg-rose-50 text-rose-700']].map(([k, v, c]) => (
            <li key={k} className="rounded-xl border border-slate-200 p-4"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${c}`}>{k}</span><p className="mt-2 text-slate-600">{v}</p></li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-slate-400">{usage.calls} AI calls this month · {usage.input_tokens.toLocaleString('en-IN')} input and {usage.output_tokens.toLocaleString('en-IN')} output tokens. Costs are estimates from published prices.</p>
      </Section>

      {limits.own_openai_key && (
        <Section title="Your own OpenAI key" description="Scoring then runs on your OpenAI account and is billed there; the platform budget doesn’t apply. The key is stored encrypted and never shown again.">
          {secret && <p className="mb-4 flex items-center gap-2 text-sm text-slate-700"><KeyRound className="size-4 text-emerald-600" /> Key ending in <code className="rounded bg-slate-100 px-1.5">…{secret.openai_key_hint}</code> saved {new Date(secret.updated_at).toLocaleDateString('en-IN')}</p>}
          {ctx.can('manageSetup') && (
            <>
              <form action={saveOpenAiKey.bind(null, slug)} className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 grow"><Field label={secret ? 'Replace key' : 'API key'} name="key" type="password" autoComplete="off" placeholder="sk-…" required /></div>
                <Button className="mb-4">Save key</Button>
              </form>
              {secret && <form action={removeOpenAiKey.bind(null, slug)}><button className={linkActionClass('danger')}>Remove key</button></form>}
            </>
          )}
        </Section>
      )}
    </>
  );
}
