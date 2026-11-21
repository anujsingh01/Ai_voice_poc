// Class strings shared by server components (ui.tsx) and client components (forms with live state),
// so every button and input on the platform looks the same.

export const controlClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[0_1px_1px_rgba(15,23,42,0.04)] placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

export const buttonVariants = {
  primary: 'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 shadow-sm hover:bg-slate-50',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
} as const;

export const buttonClass = (variant: keyof typeof buttonVariants = 'primary', size: 'md' | 'sm' = 'md') =>
  `inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${
    size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm'} ${buttonVariants[variant]}`;

/** Small inline text action ("Change", "Remove", "Copy"). */
export const linkActionClass = (tone: 'brand' | 'danger' | 'muted' = 'brand') =>
  `inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
    tone === 'brand' ? 'text-brand-700 hover:bg-brand-50' : tone === 'danger' ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-500 hover:bg-slate-100'}`;

export const fileInputClass =
  'block w-full text-sm text-slate-600 file:mr-3 file:h-10 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100';

/** Compact inline select (role pickers in tables). */
export const inlineSelectClass =
  'h-8 rounded-lg border border-slate-300 bg-white pl-2 pr-7 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15';
