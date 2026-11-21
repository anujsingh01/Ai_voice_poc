import { Mail, MessageSquare, Smartphone } from 'lucide-react';
import { Card, EmptyState, Notice, PageHeader } from '@/components/ui';
import { enabledChannels } from '@/lib/env';
import { inTenant, requireTenant } from '@/lib/tenant';

const CHANNEL = { sms: [Smartphone, 'SMS', 'bg-sky-50 text-sky-600'], whatsapp: [MessageSquare, 'WhatsApp', 'bg-emerald-50 text-emerald-600'], email: [Mail, 'Email', 'bg-brand-50 text-brand-600'] } as const;
const STATUS: Record<string, string> = {
  queued: 'bg-slate-50 text-slate-600 ring-slate-500/20', sent: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', failed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

export default async function MessagesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  const on = enabledChannels();
  const off = (['sms', 'email'] as const).filter(c => !on.includes(c));
  const messages = await inTenant(ctx, tx => tx`SELECT * FROM outbox ORDER BY id DESC LIMIT 200`);
  return (
    <>
      <PageHeader title="Sent messages" description="Every SMS and email the system has sent: interview links to candidates, reminders, and billing emails to your admins. Use it to check whether someone got their link." />
      {off.length > 0 && (
        <Notice kind="info">
          {off.map(c => CHANNEL[c][1]).join(' and ')} sending isn’t connected yet{off.includes('sms') ? ' (SMS needs the Gupshup DLT registration)' : ''}.
          Until then those messages wait here as “queued”, and recruiters can share invite links directly from the candidate list.
        </Notice>
      )}
      {messages.length === 0 ? <EmptyState icon={<MessageSquare className="size-5" />}>No messages yet.</EmptyState> : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {messages.map(m => {
              const [Icon, label, tone] = CHANNEL[m.channel as keyof typeof CHANNEL];
              return (
                <li key={m.id} className="flex gap-4 px-6 py-4">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="font-semibold text-slate-800">{label}</span>
                      <span className="tabular-nums">{m.to_address}</span>
                      <span className={`rounded-full px-2 py-0.5 font-medium capitalize ring-1 ring-inset ${STATUS[m.status]}`}>{m.status}</span>
                      <span className="ml-auto">{new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                    {m.subject && <p className="mt-1.5 font-medium text-slate-900">{m.subject}</p>}
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-slate-600">{m.body}</p>
                    {m.error && m.status !== 'sent' && (
                      <p className="mt-1.5 text-xs text-rose-700">
                        {m.status === 'failed' ? 'Gave up after' : 'Retrying after'} {m.attempts} {m.attempts === 1 ? 'try' : 'tries'}: {m.error}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
