/**
 * Turns a Member's local wall-clock rules (sleep, working hours) into
 * absolute epoch-ms intervals.
 *
 * The core hazard here is DST, and the required strategy (PLAN.md section 4)
 * is specific: never compute one UTC offset for a member and add it
 * repeatedly across the horizon. That passes every single-zone test and
 * still ships a DST bug, because the offset silently goes stale the moment
 * the horizon crosses a transition in that member's zone.
 *
 * Instead we walk each LOCAL calendar day across the horizon and construct
 * that day's window with `DateTime.fromObject({ ...day, hour, minute },
 * { zone })`. Luxon resolves the wall-clock time to a real instant itself,
 * reading whatever offset actually applies on that specific day — so the
 * offset is never memoized, it's looked up fresh per window.
 *
 * Two Luxon behaviours matter and are NOT what a naive mental model expects
 * (verified against the docs, see PLAN.md):
 *   - A spring-forward gap time (e.g. 02:30 on the transition day) is not
 *     reported as `invalid`. Luxon silently advances it (02:30 -> 03:30).
 *     `isValid` catches bad zone names, not gaps — never gate on it here.
 *   - A fall-back repeated local time is documented by Luxon as ambiguous
 *     ("should not be relied upon"): two construction paths for the same
 *     nominal wall-clock time can resolve to different offsets.
 * Rather than special-case either one, we lean on `normalize` in
 * intervals.ts: merging half-open intervals is idempotent over a duplicated
 * hour and continuous over a missing one, so whatever instant Luxon actually
 * hands back for a boundary, the merge step produces the right shape.
 */

import { DateTime } from 'luxon';
import type { Interval, Member } from './types';
import { intersect, normalize, subtract, union } from './intervals';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Local calendar days (as zoned midnights) covering `[from, to)`, padded a
 * day on each side. The padding matters at horizon extremes: a zone like
 * Pacific/Kiritimati (UTC+14) or Pacific/Niue (UTC-11) can have a local date
 * that differs from the UTC date by a full day, so anchoring the walk to UTC
 * days would silently truncate a window right at the horizon's edge.
 */
function enumerateLocalDays(zone: string, from: number, to: number): DateTime[] {
  let cursor = DateTime.fromMillis(from, { zone }).startOf('day').minus({ days: 1 });
  const end = DateTime.fromMillis(to, { zone }).startOf('day').plus({ days: 1 });

  const days: DateTime[] = [];
  while (cursor <= end) {
    days.push(cursor);
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

/**
 * The window `[startMinutes, endMinutes)` local time, anchored to local
 * calendar day `day`. `endMinutes <= startMinutes` means the window crosses
 * midnight (the normal case for sleep: 22:00 -> 07:00), so its end lands on
 * the following local day. Equal start/end is treated as an empty window
 * rather than a 24h one.
 *
 * Built with `fromObject` (day components + hour/minute), never by adding a
 * duration to a base instant — see the module comment for why.
 */
function localWindowInterval(zone: string, day: DateTime, startMinutes: number, endMinutes: number): Interval {
  const start = DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour: Math.floor(startMinutes / 60), minute: startMinutes % 60 },
    { zone },
  );
  const endDay = endMinutes >= startMinutes ? day : day.plus({ days: 1 });
  const end = DateTime.fromObject(
    { year: endDay.year, month: endDay.month, day: endDay.day, hour: Math.floor(endMinutes / 60), minute: endMinutes % 60 },
    { zone },
  );
  return { start: start.toMillis(), end: end.toMillis() };
}

/** Every local-day instance of a `[startMinutes, endMinutes)` window across the horizon, merged and clipped to it. */
function recurringWindow(zone: string, from: number, to: number, startMinutes: number, endMinutes: number): Interval[] {
  const days = enumerateLocalDays(zone, from, to);
  const raw = days.map((day) => localWindowInterval(zone, day, startMinutes, endMinutes));
  return intersect(normalize(raw), [{ start: from, end: to }]);
}

/** A member's sleep windows within `[from, to)`. HARD unavailable — never a valid meeting candidate. */
export function sleepIntervals(member: Member, from: number, to: number): Interval[] {
  return recurringWindow(member.timezone, from, to, member.sleepStart, member.sleepEnd);
}

/** A member's working-hours windows within `[from, to)`. Used only for scoring, never for hard exclusion. */
export function workIntervals(member: Member, from: number, to: number): Interval[] {
  return recurringWindow(member.timezone, from, to, member.workStart, member.workEnd);
}

/**
 * A member's awake-but-outside-working-hours time within `[from, to)`. SOFT:
 * it must remain a valid candidate and only ever affects score. An earlier
 * draft of this engine hard-excluded this set as well as penalising it,
 * which made the penalty dead code by construction — never reintroduce that.
 */
export function offHoursIntervals(member: Member, from: number, to: number): Interval[] {
  const horizon: Interval[] = [{ start: from, end: to }];
  const sleep = sleepIntervals(member, from, to);
  const work = workIntervals(member, from, to);
  const awake = subtract(horizon, sleep);
  return subtract(awake, work);
}

/**
 * A member's HARD-unavailable time within `[from, to)`: asleep, or already
 * booked. This is the only set the suggestion engine removes candidates for.
 */
export function hardBusy(member: Member, from: number, to: number): Interval[] {
  const sleep = sleepIntervals(member, from, to);
  const combined = union(sleep, member.busy);
  return intersect(combined, [{ start: from, end: to }]);
}

export { DAY_MS };
