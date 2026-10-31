import { ReactNode, useId } from 'react';

/** Accessible tooltip: shown on hover and keyboard focus, linked with aria-describedby. */
export function Tooltip({ label, tip, children }: { label?: string; tip: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <span tabIndex={0} aria-describedby={id} aria-label={label} className="cursor-help rounded focus-visible:outline-2">{children}</span>
      <span role="tooltip" id={id} className="pointer-events-none invisible absolute left-0 top-full z-20 mt-1 w-64 rounded bg-slate-900 px-2 py-1 text-xs font-normal normal-case text-white opacity-0 shadow group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        {tip}
      </span>
    </span>
  );
}
