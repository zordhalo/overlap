'use client';

import { usePrefersReducedMotion } from '@/lib/time/clock';

/**
 * A live pulse indicator — `isLive` from `useClock()`, a calendar sync in
 * progress. Reserved for genuinely live states; do not reuse for a plain
 * coloured badge. Reduced motion turns the pulse into a static filled dot
 * rather than a slowed one (see globals.css: zeroing duration alone leaves
 * the animation "half-faded" mid-cycle, which is worse than off).
 */
export function StatusDot({
  live = true,
  color = 'var(--pulse)',
  className = '',
}: {
  live?: boolean;
  color?: string;
  className?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const pulsing = live && !reducedMotion;

  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1.5 w-1.5 rounded-full ${pulsing ? 'pulse-dot' : ''} ${className}`}
      style={{ background: color }}
    />
  );
}
