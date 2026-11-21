import { ChevronRight, Download, LibraryBig } from 'lucide-react';
import Link from 'next/link';
import { Card, EmptyState, PageHeader, Section } from '@/components/ui';
import { buttonClass } from '@/components/styles';
import { inTenant, requireTenant } from '@/lib/tenant';
import { UploadForm } from './upload-form';

export default async function BanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const banks = await inTenant(ctx, tx => tx`
    SELECT b.id, b.name, v.version, v.created_at,
           (SELECT count(*) FROM questions q WHERE q.version_id = v.id AND q.type = 'question')::int AS questions,
           (SELECT count(*) FROM questions q WHERE q.version_id = v.id AND q.type = 'objection')::int AS objections,
           (SELECT count(*) FROM jobs j WHERE j.bank_id = b.id)::int AS jobs,
           (SELECT count(*) FROM question_audio a WHERE a.bank_id = b.id)::int AS audio,
           (SELECT count(*) FROM questions q, jsonb_each_text(q.texts) t WHERE q.version_id = v.id AND t.value <> '')::int AS audio_needed
    FROM question_banks b
    LEFT JOIN LATERAL (SELECT * FROM question_bank_versions WHERE bank_id = b.id ORDER BY version DESC LIMIT 1) v ON true
    ORDER BY b.name`);

  return (
    <>
      <PageHeader title="Question banks" description="The questions candidates are asked, with example good, average and poor answers the AI uses to mark them. Fill in the Excel template and upload it here. Uploading again creates a new version; past interviews keep the version they used."
                  actions={<a href={`/t/${slug}/banks/template`} className={buttonClass('secondary')}><Download className="size-4" /> Excel template</a>} />
      {banks.length === 0 ? <div className="mb-6"><EmptyState icon={<LibraryBig className="size-5" />}>No question banks yet. Download the template, fill it in and upload it below.</EmptyState></div> : (
        <Card className="mb-6">
          <ul className="divide-y divide-slate-100">
            {banks.map(b => {
              const pct = b.audio_needed ? Math.min(1, b.audio / b.audio_needed) : 0;
              return (
                <li key={b.id}>
                  <Link href={`/t/${slug}/banks/${b.id}`} className="group flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 hover:bg-slate-50/70">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><LibraryBig className="size-4.5" /></span>
                    <div className="min-w-48 flex-1">
                      <p className="font-semibold text-slate-900 group-hover:text-brand-700">{b.name}</p>
                      <p className="text-xs text-slate-500">Version {b.version ?? '—'}{b.created_at && ` · updated ${new Date(b.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`} · used by {b.jobs} job{b.jobs === 1 ? '' : 's'}</p>
                    </div>
                    <div className="flex gap-8 text-sm">
                      <div><p className="text-xs text-slate-500">Questions</p><p className="font-semibold tabular-nums">{b.questions}</p></div>
                      <div><p className="text-xs text-slate-500">Customer objections</p><p className="font-semibold tabular-nums">{b.objections}</p></div>
                      <div className="w-32">
                        <p className="text-xs text-slate-500" title="Questions read aloud in your own recorded voice. The rest are read by the computer voice.">Read in your voice</p>
                        <p className="font-semibold tabular-nums">{b.audio} <span className="font-normal text-slate-400">/ {b.audio_needed}</span></p>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct * 100}%` }} /></div>
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-slate-300 group-hover:text-slate-500" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {ctx.can('manageSetup') && (
        <Section title="Upload questions from Excel" description="Start from the template: it has one text column for each of your interview languages and two example rows. Every row is checked before anything is saved.">
          <UploadForm slug={slug} banks={banks.map(b => ({ id: b.id, name: b.name }))} />
        </Section>
      )}
    </>
  );
}
