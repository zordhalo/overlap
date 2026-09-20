'use client';

/**
 * The shared clock. One `focusInstant` — "the moment the page is currently
 * talking about" — subscribed to by both the globe and the timeline.
 *
 * Without this the globe and the timeline are two widgets that happen to both
 * show time, and the globe is decoration. With it, selecting a suggested slot
 * rotates the globe's day/night terminator to that moment, so you can *see*
 * the answer: this side of the planet is in daylight, that side is in the
 * evening, nobody is in the dark.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ClockValue = {
  /** The moment under discussion, epoch ms. */
  focusInstant: number;
  /** True while `focusInstant` is tracking real time rather than a selection. */
  isLive: boolean;
  /** Point the page at a specific moment (a scrub, or a chosen slot). */
  focus: (instant: number) => void;
  /** Hand control back to the wall clock. */
  resumeLive: () => void;
};

const ClockContext = createContext<ClockValue | null>(null);

/**
 * `tickMs` is 30s rather than 1s deliberately: nothing on the page resolves
 * finer than a minute, and a 1s interval would re-render the globe's
 * terminator sixty times more often than it can visibly change.
 */
export function ClockProvider({
  children,
  tickMs = 30_000,
  initialInstant,
}: {
  children: ReactNode;
  tickMs?: number;
  /** Server-rendered start value, so first paint is not a hydration mismatch. */
  initialInstant: number;
}) {
  const [focusInstant, setFocusInstant] = useState(initialInstant);
  const [isLive, setIsLive] = useState(true);
  const liveRef = useRef(true);

  // Kept in a ref as well as state so the interval below does not need to be
  // torn down and rebuilt every time liveness flips.
  useEffect(() => {
    liveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    const id = setInterval(() => {
      if (liveRef.current) setFocusInstant(Date.now());
    }, tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  const focus = useCallback((instant: number) => {
    setIsLive(false);
    setFocusInstant(instant);
  }, []);

  const resumeLive = useCallback(() => {
    setIsLive(true);
    setFocusInstant(Date.now());
  }, []);

  const value = useMemo<ClockValue>(
    () => ({ focusInstant, isLive, focus, resumeLive }),
    [focusInstant, isLive, focus, resumeLive],
  );

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

export function useClock(): ClockValue {
  const ctx = useContext(ClockContext);
  if (!ctx) throw new Error('useClock must be used inside a ClockProvider');
  return ctx;
}

/**
 * True when the visitor has asked for reduced motion. Both the globe's
 * auto-rotation and the overlap band's glow are gated on this, and the
 * reference design language is explicit that zeroing a duration is not
 * enough — the behaviour itself has to stop.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
