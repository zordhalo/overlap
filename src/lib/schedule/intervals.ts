/**
 * Interval algebra on half-open `[start, end)` epoch-millisecond intervals.
 *
 * Everything else in this module — availability, suggestion, scoring —
 * reduces to these four operations. They must be correct in isolation:
 * `normalize` is what lets the DST-affected callers in availability.ts get
 * away with generating a naive, possibly-overlapping or gap-ridden set of
 * windows and trusting the merge step to absorb the mess (see the comment
 * block in availability.ts for why that trust is load-bearing there).
 */

import type { Interval } from './types';

/**
 * Sort and merge a set of intervals. Touching intervals merge into one:
 * `[0,5)` and `[5,10)` share no instant, but there is also no instant
 * between them, so leaving them separate would let a caller believe there is
 * a one-tick gap that does not exist. This is also what makes a DST fall-back
 * repeated hour — generated as two overlapping or touching raw intervals by
 * the naive per-local-day walk — collapse into a single correct interval
 * instead of double-counting it.
 */
export function normalize(intervals: Interval[]): Interval[] {
  const valid = intervals.filter((interval) => interval.end > interval.start);
  if (valid.length === 0) return [];

  const sorted = [...valid].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && current.start <= last.end) {
      if (current.end > last.end) last.end = current.end;
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Set union. Just normalize over the concatenation. */
export function union(a: Interval[], b: Interval[]): Interval[] {
  return normalize([...a, ...b]);
}

/**
 * Set intersection, clipped: overlapping regions are returned at their
 * actual overlap bounds, not as whole matched intervals. A two-pointer sweep
 * over two normalized (sorted, non-overlapping) sequences.
 */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const na = normalize(a);
  const nb = normalize(b);
  const result: Interval[] = [];

  let i = 0;
  let j = 0;
  while (i < na.length && j < nb.length) {
    const ai = na[i];
    const bj = nb[j];
    // Unreachable given the loop bounds, but noUncheckedIndexedAccess can't
    // see that; narrow explicitly rather than asserting past it.
    if (ai === undefined || bj === undefined) break;

    const start = Math.max(ai.start, bj.start);
    const end = Math.min(ai.end, bj.end);
    if (start < end) result.push({ start, end });

    if (ai.end < bj.end) i++;
    else j++;
  }
  return result;
}

/**
 * Set difference `a \ b`. Walks each interval of `a` left to right, cutting
 * out every overlapping piece of `b` as it goes. A cut in the middle of an
 * interval produces two output intervals either side of it.
 */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const na = normalize(a);
  const nb = normalize(b);
  const result: Interval[] = [];

  for (const interval of na) {
    let cursor = interval.start;
    for (const cut of nb) {
      if (cut.end <= cursor || cut.start >= interval.end) continue;
      if (cut.start > cursor) {
        result.push({ start: cursor, end: Math.min(cut.start, interval.end) });
      }
      cursor = Math.max(cursor, cut.end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
}

/** Total covered duration in milliseconds. Normalizes first so overlapping input never double-counts. */
export function totalDuration(intervals: Interval[]): number {
  return normalize(intervals).reduce((sum, interval) => sum + (interval.end - interval.start), 0);
}
