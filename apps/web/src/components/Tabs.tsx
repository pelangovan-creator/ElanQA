import { KeyboardEvent, ReactNode, useId, useRef } from 'react';

/** Accessible tabs (WAI-ARIA tabs pattern: arrow keys, Home/End, roving tabindex). */
export function Tabs<T extends string>({ tabs, value, onChange, children }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void; children: ReactNode }) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div>
      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`${base}-${t.id}`} aria-selected={value === t.id} aria-controls={`${base}-panel`}
            tabIndex={value === t.id ? 0 : -1} onKeyDown={(e) => onKey(e, i)} onClick={() => onChange(t.id)}
            className={`-mb-px min-h-9 border-b-2 px-3 text-sm ${value === t.id ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${value}`}>{children}</div>
    </div>
  );
}
