import { notFound } from 'next/navigation';
import { Download, ShieldAlert } from 'lucide-react';
import { buttonClass } from '@/components/styles';
import { PageHeader, Section } from '@/components/ui';
import { languageName } from '@/lib/languages';
import { inTenant, requireTenant } from '@/lib/tenant';
import { UploadForm } from '../upload-form';
import { AudioCell } from './audio-cell';

export default async function BankPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireTenant(slug);
  const data = await inTenant(ctx, async tx => {
    const [bank] = await tx`SELECT * FROM question_banks WHERE id = ${id}`;
    if (!bank) return null;
    const versions = await tx`
      SELECT v.id, v.version, v.file_name, v.created_at, u.name AS uploaded_by,
             (SELECT count(*) FROM questions q WHERE q.version_id = v.id)::int AS rows
      FROM question_bank_versions v LEFT JOIN users u ON u.id = v.uploaded_by
      WHERE v.bank_id = ${id} ORDER BY v.version DESC`;
    const questions = versions.length
      ? await tx`SELECT * FROM questions WHERE version_id = ${versions[0].id} ORDER BY position` : [];
    const audio = await tx`SELECT id, code, language FROM question_audio WHERE bank_id = ${id}`;
    return { bank, versions, questions, audio };
  });
  if (!data) notFound();
  const { bank, versions, questions, audio } = data;
  const audioFor = (code: string, lang: string) => audio.find(a => a.code === code && a.language === lang) as { id: string } | undefined;
  const languages = [...new Set(questions.flatMap(q => Object.keys(q.texts as Record<string, string>).filter(l => (q.texts as Record<string, string>)[l])))];
  const needed = questions.length * languages.length;
  const recorded = questions.reduce((n, q) => n + languages.filter(l => audioFor(q.code, l)).length, 0);
  const edit = ctx.can('manageSetup');

  return (
    <>
      <PageHeader
        title={bank.name}
        back={{ href: `/t/${slug}/banks`, label: 'Question banks' }}
        description={versions.length > 0 ? `Version ${versions[0].version} · ${questions.length} items · audio recorded for ${recorded} of ${needed}` : undefined}
        actions={versions.length > 0 && <a href={`/t/${slug}/banks/template?bank=${id}`} className={buttonClass('secondary')}><Download className="size-4" /> Download as Excel</a>}
      />
      {needed > 0 && (
        <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-5">
          <div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-700">Question recordings</span><span className="tabular-nums text-slate-500">{recorded} / {needed}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(100 * recorded) / needed}%` }} /></div>
          <p className="mt-2 text-xs text-slate-500">Every candidate hears the same recording. Record in a quiet room at a natural pace. Recordings stay linked to the question code across new versions.</p>
        </div>
      )}

      <div className="space-y-4">
        {questions.map(q => (
          <article key={q.id} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-semibold text-white">{q.code}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${q.type === 'objection' ? 'bg-amber-50 text-amber-800 ring-amber-600/20' : 'bg-brand-50 text-brand-700 ring-brand-600/20'}`}>
                {q.type === 'objection' ? 'Customer objection' : 'Question'}
              </span>
              <span className="text-xs text-slate-500">{q.category} · weight {q.weight}</span>
              {q.knockout && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20" title={q.knockout_rule}><ShieldAlert className="size-3" /> Knockout</span>}
            </div>
            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                {languages.map(l => (
                  <p key={l} className="text-[15px] leading-relaxed text-slate-800" lang={l}>
                    <span className="mr-2 inline-block w-7 text-xs font-medium uppercase text-slate-400">{l}</span>{(q.texts as Record<string, string>)[l]}
                  </p>
                ))}
                <details className="group mt-2 text-sm text-slate-600">
                  <summary className="cursor-pointer list-none text-xs font-semibold text-brand-700 hover:text-brand-800"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span> model answers</summary>
                  <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                    {[['Good', q.good_answer, 'border-emerald-200 bg-emerald-50/60 text-emerald-900'], ['Average', q.average_answer, 'border-amber-200 bg-amber-50/60 text-amber-900'], ['Poor', q.poor_answer, 'border-rose-200 bg-rose-50/60 text-rose-900']].map(([k, v, c]) => (
                      <div key={k} className={`rounded-xl border p-3 ${c}`}><dt className="mb-1 text-xs font-semibold uppercase tracking-wide">{k}</dt><dd className="text-sm leading-relaxed">{v}</dd></div>
                    ))}
                  </dl>
                  {(q.must_mention as string[]).length > 0 && <p className="mt-2 text-xs"><b>Must mention:</b> {(q.must_mention as string[]).join(', ')}</p>}
                  {q.knockout && <p className="mt-1 text-xs text-rose-800"><b>Knockout rule:</b> {q.knockout_rule}</p>}
                </details>
              </div>
              <div className="flex flex-wrap gap-4 lg:flex-col">
                {languages.map(l => (q.texts as Record<string, string>)[l] && (
                  <div key={l}>
                    <p className="mb-1 text-xs font-medium text-slate-500">{languageName(l)} audio</p>
                    <AudioCell slug={slug} bankId={id} code={q.code} language={l} audio={audioFor(q.code, l) ?? null} canEdit={edit} />
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        {edit && (
          <Section title="Upload a new version" description="Download as Excel, edit, and upload here. Interviews already done keep the version they used.">
            <UploadForm slug={slug} banks={[{ id, name: bank.name }]} defaultBank={id} />
          </Section>
        )}
        <Section title="Version history">
          {versions.length === 0 ? <p className="text-sm text-slate-500">No versions yet.</p> : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {versions.map((v, i) => (
                <li key={v.id} className="text-sm">
                  <span className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-4 ring-white ${i === 0 ? 'bg-brand-500' : 'bg-slate-300'}`} />
                  <p className="font-medium text-slate-900">Version {v.version} {i === 0 && <span className="ml-1 text-xs font-normal text-brand-600">current</span>}</p>
                  <p className="text-xs text-slate-500">{v.rows} rows · {v.file_name} · {v.uploaded_by} · {new Date(v.created_at).toLocaleString('en-IN')}</p>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
}
