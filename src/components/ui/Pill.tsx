import type { ButtonHTMLAttributes } from 'react';

/**
 * The single filled-white action on a screen (PLAN.md: "one filled white
 * pill per screen, maximum"). A plain <button> by default; pass `asChild`
 * styling needs by rendering an <a> yourself with the same `.btn-pill`
 * class instead of trying to make this component polymorphic — it stays a
 * button because that is what it will almost always be ("Add to calendar"
 * triggers a download / server action, not a navigation).
 */
export function Pill({
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn-pill ${className}`} {...props}>
      {children}
    </button>
  );
}
