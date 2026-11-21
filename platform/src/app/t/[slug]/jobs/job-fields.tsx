import { Field, Select, Textarea } from '@/components/ui';
import { languageName } from '@/lib/languages';

export type JobValues = {
  title: string; location: string | null; description: string | null; bank_id: string | null; languages: string[];
  questions_per_interview: number; objections_per_interview: number; answer_seconds: number; invite_valid_days: number;
};
export const NEW_JOB: JobValues = {
  title: '', location: '', description: '', bank_id: null, languages: [],
  questions_per_interview: 6, objections_per_interview: 3, answer_seconds: 90, invite_valid_days: 7,
};

export function JobFields({ job, banks, tenantLanguages, disabled }: {
  job: JobValues; banks: { id: string; name: string }[]; tenantLanguages: string[]; disabled?: boolean;
}) {
  const langs = job.languages.length ? job.languages : tenantLanguages;
  return (
    <fieldset disabled={disabled}>
      <Field label="Job title" name="title" defaultValue={job.title} required placeholder="Field Sales Executive" />
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Location" name="location" defaultValue={job.location ?? ''} placeholder="Chennai" />
        <Select label="Question bank" name="bank_id" defaultValue={job.bank_id ?? ''}>
          <option value="">— choose later —</option>
          {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </div>
      <Textarea label="Description (shown to candidates)" name="description" rows={3} defaultValue={job.description ?? ''} />
      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-medium text-slate-700">Languages candidates can choose</legend>
        <div className="flex flex-wrap gap-2">
          {tenantLanguages.map(code => (
            <label key={code} className="cursor-pointer">
              <input type="checkbox" name="languages" value={code} defaultChecked={langs.includes(code)} className="peer sr-only" />
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-600 transition peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:font-medium peer-checked:text-brand-700 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20">
                {languageName(code)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Questions per interview" name="questions_per_interview" type="number" min={1} max={20} defaultValue={job.questions_per_interview} required />
        <Field label="Customer objections" name="objections_per_interview" type="number" min={0} max={10} defaultValue={job.objections_per_interview} required />
        <Field label="Seconds per answer" name="answer_seconds" type="number" min={30} max={300} defaultValue={job.answer_seconds} required />
        <Field label="Link works for (days)" name="invite_valid_days" type="number" min={1} max={30} defaultValue={job.invite_valid_days} required />
      </div>
    </fieldset>
  );
}
