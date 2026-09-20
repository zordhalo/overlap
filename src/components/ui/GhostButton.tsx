import type { ButtonHTMLAttributes } from 'react';

/**
 * The secondary action: no fill, a slit outline (see `.btn-ghost` in
 * globals.css) that overshoots and crosses at the corners like a card
 * frame. Use for anything that isn't the one filled action on the screen —
 * "Copy link," "Edit availability," etc.
 */
export function GhostButton({
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn-ghost ${className}`} {...props}>
      {children}
    </button>
  );
}
