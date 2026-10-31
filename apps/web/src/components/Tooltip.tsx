import { ReactNode, useId } from 'react';

/**
 * Accessible tooltip: shown on hover and keyboard focus, linked with aria-describedby.
 * Hidden with display:none (not visibility) so closed tooltips never widen the page on small screens.
 */
export function Tooltip({ label, tip, children }: { label?: string; tip: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <span tabIndex={0} aria-describedby={id} aria-label={label} className="cursor-help rounded focus-visible:outline-2">{children}</span>
      <span role="tooltip" id={id} className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-64 max-w-[80vw] rounded bg-slate-900 px-2 py-1 text-xs font-normal normal-case text-white shadow group-focus-within:block group-hover:block">
        {tip}
      </span>
    </span>
  );
}
