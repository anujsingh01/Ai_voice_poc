import { Avatar } from './ui';

/** Avatar, name and email for user lists. */
export function PersonCell({ name, email, you }: { name: string; email: string; you?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} size="sm" />
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{name}{you && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">You</span>}</p>
        <p className="truncate text-xs text-slate-500">{email}</p>
      </div>
    </div>
  );
}

/** Whether a user has set their password and turned on 2-step login. */
export function AccessStatus({ active, twoStep }: { active: boolean; twoStep: boolean }) {
  const [label, style] = !active ? ['Invited', 'bg-slate-50 text-slate-600 ring-slate-500/20']
    : twoStep ? ['Active · 2-step on', 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'] : ['Active', 'bg-brand-50 text-brand-700 ring-brand-600/20'];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}>{label}</span>;
}
