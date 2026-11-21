import { Field, Select } from '@/components/ui';
import { INTERVIEW_LANGUAGES } from '@/lib/languages';

export type Limits = {
  interviews_per_month: number; concurrent_jobs: number; recruiter_seats: number; ai_budget_inr: number;
  retention_days: number; scoring_mode: string; own_openai_key: boolean; languages: string[];
};

export const DEFAULT_LIMITS: Limits = {
  interviews_per_month: 1000, concurrent_jobs: 5, recruiter_seats: 5, ai_budget_inr: 5000,
  retention_days: 180, scoring_mode: 'fast', own_openai_key: false, languages: ['hi', 'en'],
};

export function LimitsFields({ limits }: { limits: Limits }) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Interviews per month" name="interviews_per_month" type="number" min={0} defaultValue={limits.interviews_per_month} required
               hint="Warning at 80%; new invites blocked at 100%." />
        <Field label="Concurrent active jobs" name="concurrent_jobs" type="number" min={0} defaultValue={limits.concurrent_jobs} required />
        <Field label="Recruiter seats" name="recruiter_seats" type="number" min={0} defaultValue={limits.recruiter_seats} required />
        <Field label="AI scoring budget (₹ / month)" name="ai_budget_inr" type="number" min={0} defaultValue={limits.ai_budget_inr} required
               hint="Switches to Batch at 90%; pauses scoring at 100%." />
        <Field label="Data retention (days)" name="retention_days" type="number" min={1} max={730} defaultValue={limits.retention_days} required
               hint="Auto-deletion with 48-hour candidate notice." />
        <Select label="Scoring mode" name="scoring_mode" defaultValue={limits.scoring_mode}>
          <option value="fast">Fast (results in minutes)</option>
          <option value="batch">Batch (within 24 h, half the cost)</option>
        </Select>
      </div>
      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-medium text-slate-700">Interview languages</legend>
        <div className="flex flex-wrap gap-2">
          {INTERVIEW_LANGUAGES.map(([code, name]) => (
            <label key={code} className="cursor-pointer">
              <input type="checkbox" name="languages" value={code} defaultChecked={limits.languages.includes(code)} className="peer sr-only" />
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-600 transition peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:font-medium peer-checked:text-brand-700 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20">{name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mb-4 flex cursor-pointer items-center gap-3 text-sm text-slate-700">
        <input type="checkbox" name="own_openai_key" defaultChecked={limits.own_openai_key} className="size-4 accent-brand-600" />
        Company uses its own OpenAI key (usage bills to them; AI budget limit not applied)
      </label>
    </>
  );
}
