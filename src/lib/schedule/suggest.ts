/**
 * The ranked-slot search. Pure function: `Member[]` + `SuggestOptions` in,
 * `SuggestResult` out. Every candidate window that is HARD-free for
 * everyone gets scored; nothing is thrown away for being merely off-hours,
 * per the HARD/SOFT split in availability.ts.
 */

import type { Interval, Member, MemberCost, CostReason, Slot, SuggestOptions, SuggestResult } from './types';
import { intersect, subtract, totalDuration, union } from './intervals';
import { hardBusy, sleepIntervals, workIntervals } from './availability';
import { DAY_MS } from './availability';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Kept in sync with the comment on `MemberCost.penalty` in types.ts.
 * `nearSleep` is 25, not a plain 10, so that dragging one person to the edge
 * of their sleep always outranks off-hours inconvenience merely spread
 * across a group: at a realistic group size, `offHours * groupSize` (e.g.
 * 2 * 6 = 12) would otherwise beat a lone 10, ranking "make one person
 * suffer badly" above "mildly inconvenience everyone" — backwards for a
 * scheduling tool. 25 dominates any group size worth supporting.
 *
 * This is a per-slot cost distribution, not fairness across meetings: the
 * engine is stateless and has no memory of who took the last early call, so
 * identical inputs always produce the identical ranking. It only spreads
 * cost within a single meeting's candidate set.
 */
export const PENALTY = {
  work: 0,
  offHours: 2,
  nearSleep: 25,
} as const;

const DEFAULT_STEP_MINUTES = 15;
const DEFAULT_LIMIT = 10;

export function suggest(members: Member[], options: SuggestOptions): SuggestResult {
  const stepMs = (options.stepMinutes ?? DEFAULT_STEP_MINUTES) * 60 * 1000;
  const durationMs = options.durationMinutes * 60 * 1000;
  const limit = options.limit ?? DEFAULT_LIMIT;

  // Anchor the candidate grid to a clock boundary rather than to whatever
  // instant the caller happened to pass. Callers pass Date.now(), so without
  // this every suggestion reads "08:01" or "13:47" — technically a valid free
  // window, and something nobody would ever propose as a meeting time.
  //
  // Rounding in UTC is sufficient: every IANA zone is offset from UTC by a
  // whole number of 15-minute units (including the :30 and :45 zones), so a
  // 15-minute UTC boundary is also a 15-minute boundary in every member's
  // local wall clock. Rounding UP, never down, so a slot is never proposed in
  // the past.
  const gridStart = Math.ceil(options.from / stepMs) * stepMs;
  const horizon: Interval = { start: gridStart, end: options.from + options.horizonDays * DAY_MS };

  // Padded a day either side so a member's sleep/work windows are complete
  // right up against the horizon's edges — both for hard exclusion and for
  // the near-sleep-boundary scoring below, which looks just outside the
  // slot itself and would otherwise see nothing to compare against there.
  const paddedFrom = horizon.start - DAY_MS;
  const paddedTo = horizon.end + DAY_MS;

  const perMember = members.map((member) => ({
    member,
    sleep: sleepIntervals(member, paddedFrom, paddedTo),
    work: workIntervals(member, paddedFrom, paddedTo),
    // Hard-busy is computed on the padded range for symmetry, then clipped
    // back to the real horizon — only busy time inside the search window
    // should ever remove a candidate or count as a blocker.
    hardBusy: intersect(hardBusy(member, paddedFrom, paddedTo), [horizon]),
  }));

  const allHardBusy = perMember.reduce<Interval[]>((acc, m) => union(acc, m.hardBusy), []);
  const free = subtract([horizon], allHardBusy);

  const slots: Slot[] = [];
  for (const window of free) {
    // Candidates align to one grid anchored at the search start (`options.from`),
    // not at each free window's own boundary — otherwise the grid would
    // silently shift per fragment, and which minutes count as "on the grid"
    // would depend on how busy time happened to fragment the horizon.
    const firstOffset = (stepMs - ((window.start - horizon.start) % stepMs)) % stepMs;
    for (let t = window.start + firstOffset; t + durationMs <= window.end; t += stepMs) {
      const slotInterval: Interval = { start: t, end: t + durationMs };
      const costs = perMember.map(({ member, sleep, work }) => scoreMember(member.id, slotInterval, sleep, work));
      const score = costs.reduce((sum, cost) => sum + cost.penalty, 0);
      slots.push({ start: slotInterval.start, end: slotInterval.end, score, variance: variance(costs), costs });
    }
  }

  if (slots.length === 0) {
    const blockers = perMember.map(({ member, hardBusy: busy }) => ({
      memberId: member.id,
      blockedMinutes: Math.round(totalDuration(busy) / 60000),
    }));
    return { kind: 'none', blockers };
  }

  // Sort key is (score, maxPenalty, variance). Score is the primary and only
  // documented rank (Slot.score "alone determines rank" per types.ts) — but
  // ties on score can still hide a single-victim slot next to an
  // evenly-spread one with the same sum, so maxPenalty (computed here, not
  // stored on the frozen Slot type) breaks that tie toward whichever slot
  // dumps less cost on any one person, before variance gets the final word.
  slots.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const maxA = maxPenalty(a.costs);
    const maxB = maxPenalty(b.costs);
    if (maxA !== maxB) return maxA - maxB;
    return a.variance - b.variance;
  });
  return { kind: 'slots', slots: slots.slice(0, limit) };
}

/**
 * Per the burden table: 0 inside working hours, 2 awake-but-off-hours, 25
 * within an hour of a sleep boundary. The near-sleep-boundary check runs
 * first and can override an otherwise-"working hours" slot, because it is
 * the more severe cost — someone whose workday starts the instant they wake
 * up is still paying the early-start penalty for that first hour.
 */
function scoreMember(memberId: string, slot: Interval, sleep: Interval[], work: Interval[]): MemberCost {
  const sinceWaking = closestGapAfter(sleep, slot.start);
  const untilSleep = closestGapBefore(sleep, slot.end);
  const early = sinceWaking !== null && sinceWaking <= HOUR_MS ? sinceWaking : null;
  const late = untilSleep !== null && untilSleep <= HOUR_MS ? untilSleep : null;

  if (early !== null || late !== null) {
    // Squeezed between two sleep windows (a very short waking gap): name
    // whichever boundary is closer, defaulting to "late" on an exact tie or
    // when only one boundary is within range.
    const reason: CostReason = late !== null && (early === null || late <= early) ? 'late' : 'early';
    return { memberId, penalty: PENALTY.nearSleep, reason };
  }

  const insideWork = work.some((w) => slot.start >= w.start && slot.end <= w.end);
  if (insideWork) return { memberId, penalty: PENALTY.work, reason: 'work' };
  return { memberId, penalty: PENALTY.offHours, reason: 'off-hours' };
}

/** Milliseconds since the nearest sleep interval that ended at or before `point`; null if none does. */
function closestGapAfter(sleep: Interval[], point: number): number | null {
  let best: number | null = null;
  for (const s of sleep) {
    if (s.end <= point) {
      const gap = point - s.end;
      if (best === null || gap < best) best = gap;
    }
  }
  return best;
}

/** Milliseconds until the nearest sleep interval that starts at or after `point`; null if none does. */
function closestGapBefore(sleep: Interval[], point: number): number | null {
  let best: number | null = null;
  for (const s of sleep) {
    if (s.start >= point) {
      const gap = s.start - point;
      if (best === null || gap < best) best = gap;
    }
  }
  return best;
}

/** Population variance of per-member penalties. Only ever breaks an exact `score`+`maxPenalty` tie — see types.ts. */
function variance(costs: MemberCost[]): number {
  if (costs.length === 0) return 0;
  const mean = costs.reduce((sum, cost) => sum + cost.penalty, 0) / costs.length;
  return costs.reduce((sum, cost) => sum + (cost.penalty - mean) ** 2, 0) / costs.length;
}

/** The single worst per-member penalty in a slot. Used only to break a `score` tie during sort — never stored. */
function maxPenalty(costs: MemberCost[]): number {
  return costs.reduce((max, cost) => Math.max(max, cost.penalty), 0);
}
