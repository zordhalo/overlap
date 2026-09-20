import type { HTMLAttributes } from 'react';

/**
 * Card wrapper: four slit lines overshooting the box and crossing at the
 * corners (see `.slit-frame` in globals.css). Renders as a <div> — the
 * overshoot is drawn by a ::before pseudo-element that needs `position:
 * relative` on this box and generous surrounding margin from the caller
 * (a neighbour's overshoot must never touch this one's, per PLAN.md).
 *
 * `bright` is the selected/active variant (e.g. the top-ranked slot card).
 */
export function SlitFrame({
  bright = false,
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { bright?: boolean }) {
  return (
    <div
      className={`slit-frame ${bright ? 'slit-frame-bright' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
