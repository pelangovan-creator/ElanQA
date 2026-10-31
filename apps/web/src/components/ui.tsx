import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, useId } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-400',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  ghost: 'text-slate-700 hover:bg-slate-100',
};

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  // min-h-6 satisfies WCAG 2.2 target size (2.5.8); we use 36px for comfort.
  return <button className={cx('inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed', VARIANT[variant], className)} {...p} />;
}

export function Field({ label, error, hint, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">{label}{p.required && <span aria-hidden="true" className="text-red-700"> *</span>}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className="min-h-9 rounded-md border border-slate-400 bg-white px-3 text-sm aria-[invalid=true]:border-red-700" {...p} />
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-slate-600">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function Select({ label, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">{label}</label>
      <select id={id} className="min-h-9 rounded-md border border-slate-400 bg-white px-2 text-sm" {...p}>{children}</select>
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white p-4 shadow-sm', className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const BADGE: Record<string, string> = {
  red: 'bg-red-100 text-red-800 ring-red-300', amber: 'bg-amber-100 text-amber-900 ring-amber-300',
  green: 'bg-green-100 text-green-800 ring-green-300', blue: 'bg-brand-100 text-brand-900 ring-brand-100', gray: 'bg-slate-100 text-slate-700 ring-slate-300',
};
export function Badge({ color = 'gray', children }: { color?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE[color])}>{children}</span>;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const style = { error: 'border-red-300 bg-red-50 text-red-800', success: 'border-green-300 bg-green-50 text-green-800', info: 'border-brand-100 bg-brand-50 text-brand-900' }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={cx('rounded-md border px-3 py-2 text-sm', style)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ head, children, caption }: { head: string[]; children: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-b border-slate-200 text-xs uppercase text-slate-600">
          <tr>{head.map((h, i) => <th key={i} scope="col" className="px-2 py-2 font-semibold">{h || <span className="sr-only">{i === 0 ? 'Select' : 'Actions'}</span>}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
