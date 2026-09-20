/**
 * Geometry + the timeline's own vocabulary for member availability.
 *
 * The engine (src/lib/schedule) is being built in parallel by another agent.
 * To stay independent of its internal shape while it's still moving, this
 * module defines its own `MemberBands` — the pages agent is responsible for
 * computing one of these per member from the real engine output and passing
 * them down as props. Nothing here imports from `@/lib/schedule` except the
 * frozen `Interval` type, which is part of the immutable contract.
 */

import type { Interval } from '@/lib/schedule/types';

/**
 * One member's day, pre-split into the three overlapping-but-distinct bands
 * the timeline paints. `busy` and `offHours` may overlap in principle (a
 * calendar event during someone's off-hours) — the timeline is responsible
 * for stacking them, not this module, since stacking order is a rendering
 * decision, not a geometry one.
 */
export type MemberBands = {
  memberId: string;
  asleep: Interval[];
  offHours: Interval[];
  busy: Interval[];
};

/** A rendering window: the half-open [from, to) span mapped onto 0..100%. */
export type Window = { from: number; to: number };

/**
 * Position of an instant within `window`, as a percentage. Not clamped —
 * callers that need a clamped value use `clipToWindow` first, which is the
 * more common need (an interval, not a lone instant).
 */
export function toPercent(instant: number, window: Window): number {
  const span = window.to - window.from;
  // A zero-width window has no meaningful position; 0 is as good as any
  // other answer and avoids a NaN propagating into a CSS `left` value.
  if (span <= 0) return 0;
  return ((instant - window.from) / span) * 100;
}

/**
 * Clip an interval to `window` and return it as a `{ left, width }` percent
 * pair ready for inline styles, or `null` if it doesn't intersect the window
 * at all. Half-open throughout: an interval that starts exactly at
 * `window.to` or ends exactly at `window.from` does not intersect.
 */
export function clipToWindow(
  interval: Interval,
  window: Window,
): { left: number; width: number } | null {
  const start = Math.max(interval.start, window.from);
  const end = Math.min(interval.end, window.to);
  if (end <= start) return null;
  const left = toPercent(start, window);
  const width = toPercent(end, window) - left;
  return { left, width };
}

/**
 * Split an interval into per-local-day pieces, each tagged with the local
 * calendar date (`YYYY-MM-DD` in `zone`) it falls on. Needed because a band
 * crossing local midnight (an overnight sleep window, or any interval that
 * happens to straddle a day boundary in the viewer's zone) must still be
 * attributable to "which day's tick column" when the timeline lays out day
 * labels — see PLAN.md section 6, "label days in the viewer's zone."
 *
 * Splits occur at local-midnight instants, found by walking forward from the
 * interval start rather than by adding a fixed 24h offset, so this holds
 * across a DST boundary the same way the engine's own generation does.
 */
export function splitByDay(interval: Interval, zone: string): (Interval & { day: string })[] {
  if (interval.end <= interval.start) return [];

  const out: (Interval & { day: string })[] = [];
  let cursor = interval.start;

  while (cursor < interval.end) {
    const cursorLocal = DateTimeFromMillis(cursor, zone);
    const day = cursorLocal.toISODate() ?? isoDateFallback(cursor, zone);
    const nextMidnight = cursorLocal
      .plus({ days: 1 })
      .startOf('day')
      .toMillis();
    const pieceEnd = Math.min(nextMidnight, interval.end);
    out.push({ start: cursor, end: pieceEnd, day });
    cursor = pieceEnd;
  }

  return out;
}

// Isolated behind a tiny wrapper so this file's Luxon usage is one import,
// matching how the engine centralizes its own DateTime construction.
import { DateTime } from 'luxon';

function DateTimeFromMillis(ms: number, zone: string): DateTime {
  return DateTime.fromMillis(ms, { zone });
}

/**
 * `toISODate()` only returns null for an invalid DateTime (bad zone name);
 * a bad zone is a caller bug, not a runtime condition to silently swallow,
 * but returning NaN-laced strings downstream is worse, so fall back to the
 * UTC calendar date rather than throw mid-render.
 */
function isoDateFallback(ms: number, zone: string): string {
  void zone;
  return DateTime.fromMillis(ms, { zone: 'utc' }).toISODate() ?? '1970-01-01';
}
