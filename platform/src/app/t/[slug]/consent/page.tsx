import { CheckCircle2, Save } from 'lucide-react';
import { Button, Field, Notice, PageHeader, Section, Textarea, messageFor } from '@/components/ui';
import { DEFAULT_CONSENT } from '@/lib/consent';
import { languageName } from '@/lib/languages';
import { inTenant, requireTenant, tenantLimits } from '@/lib/tenant';
import { saveConsent } from './actions';

const MESSAGES = { saved: 'Saved as a new version. New interviews use it; past consent records keep the version the candidate agreed to.' };
const ERRORS = {
  contact: 'Enter a grievance contact (a named person or team, with email or phone).',
  empty: 'Write the notice in at least one language.',
  too_long: 'Each notice must be under 6,000 characters.',
};

export default async function ConsentPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const { current, limits, history } = await inTenant(ctx, async tx => ({
    current: (await tx`SELECT * FROM consent_texts ORDER BY version DESC LIMIT 1`)[0],
    limits: await tenantLimits(tx, ctx.tenant.id),
    history: await tx`SELECT c.version, c.created_at, u.name FROM consent_texts c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.version DESC LIMIT 10`,
  }));
  const { msg, error } = await searchParams;
  const note = messageFor(msg, MESSAGES), err = messageFor(error, ERRORS);
  const texts = (current?.texts ?? {}) as Record<string, string>;
  const edit = ctx.can('manageSetup');
  const missing = limits.languages.filter(l => !texts[l]);

  return (
    <>
      <PageHeader title="Consent text" description="What candidates must read and agree to before the interview records them. Needed in every interview language (DPDP Act 2023, Rules 2025)."
                  actions={current && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20"><CheckCircle2 className="size-3.5" /> Version {current.version} live</span>} />
      {note && <Notice kind="success">{note}</Notice>}
      {err && <Notice>{err}</Notice>}
      {!current && <Notice kind="info">Not saved yet. A draft is filled in below. Have your legal or HR reviewer check it, then save. Jobs can’t go live until this is saved.</Notice>}
      {current && missing.length > 0 && <Notice>No notice yet in {missing.map(languageName).join(', ')}. Jobs offering those languages can’t go live until you add it.</Notice>}

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_20rem]">
        <form action={saveConsent.bind(null, slug)} className="min-w-0">
          <Section title="Notice text" description="This draft is not legal advice; it must be reviewed before go-live.">
            <fieldset disabled={!edit}>
              <Field label="Grievance contact" name="grievance_contact" required defaultValue={current?.grievance_contact ?? ''}
                     placeholder="Grievance Officer, HR – privacy@yourcompany.com, +91 …" />
              {limits.languages.map(l => (
                <Textarea key={l} label={`Notice in ${languageName(l)}`} name={`text_${l}`} rows={12} lang={l}
                          defaultValue={texts[l] ?? (current ? '' : DEFAULT_CONSENT[l] ?? '')}
                          hint={!DEFAULT_CONSENT[l] && !texts[l] ? 'No draft for this language yet: translate the English notice and have a native speaker check it.' : undefined} />
              ))}
            </fieldset>
            {edit && <Button><Save className="size-4" /> Save as new version</Button>}
          </Section>
        </form>
        <div className="space-y-6 xl:sticky xl:top-8">
          <Section title="Filled in automatically">
            <dl className="space-y-2 text-sm">
              {[['{company}', ctx.tenant.name], ['{days}', `${limits.retention_days} (your retention period)`], ['{contact}', 'The grievance contact']].map(([k, v]) => (
                <div key={k}><dt className="font-mono text-xs font-semibold text-brand-700">{k}</dt><dd className="text-slate-600">{v}</dd></div>
              ))}
            </dl>
          </Section>
          {history.length > 0 && (
            <Section title="Versions">
              <ol className="relative space-y-3 border-l border-slate-200 pl-5">
                {history.map((h, i) => (
                  <li key={h.version} className="text-sm">
                    <span className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-4 ring-white ${i === 0 ? 'bg-brand-500' : 'bg-slate-300'}`} />
                    <p className="font-medium text-slate-900">Version {h.version}</p>
                    <p className="text-xs text-slate-500">{h.name} · {new Date(h.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
