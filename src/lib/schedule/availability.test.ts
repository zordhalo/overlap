import { describe, expect, it } from 'vitest';
import { hardBusy, sleepIntervals } from './availability';
import { totalDuration } from './intervals';
import { localMs, makeMember } from './test-helpers';

const HOUR = 60 * 60 * 1000;

describe('sleepIntervals', () => {
  // Case 1: a midnight-crossing sleep window (22:00 -> 07:00) yields two
  // separate intervals inside a single local day's horizon, not one interval
  // with a negative or wraparound length.
  it('splits a midnight-crossing window into the two intervals a single day actually contains', () => {
    const zone = 'America/Toronto';
    const toronto = makeMember({ id: 'lucas', timezone: zone });
    const dayStart = localMs(zone, 2026, 6, 10, 0, 0);
    const dayEnd = localMs(zone, 2026, 6, 11, 0, 0);

    const intervals = sleepIntervals(toronto, dayStart, dayEnd);

    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toEqual({ start: dayStart, end: localMs(zone, 2026, 6, 10, 7, 0) });
    expect(intervals[1]).toEqual({ start: localMs(zone, 2026, 6, 10, 22, 0), end: dayEnd });
    for (const interval of intervals) expect(interval.end).toBeGreaterThan(interval.start);
  });

  // Case 2: horizon extremes (UTC+14, UTC-11) still get the right number of
  // local days. A 3-local-day horizon has exactly 3 days' worth of sleep
  // (27h), regardless of how the local calendar date sits relative to UTC.
  it.each([
    ['Pacific/Kiritimati', 14 * 60],
    ['Pacific/Niue', -11 * 60],
  ])('accumulates exactly 3 local days of sleep in %s (UTC offset %d min)', (zone) => {
    const member = makeMember({ id: 'traveler', timezone: zone });
    const from = localMs(zone, 2026, 6, 10, 0, 0);
    const to = localMs(zone, 2026, 6, 13, 0, 0); // 3 local days later

    const intervals = sleepIntervals(member, from, to);
    expect(totalDuration(intervals)).toBe(3 * 9 * HOUR);
  });

  // Case 3: spring-forward. America/Toronto jumps 02:00 -> 03:00 on
  // 2026-03-08. The night of Mar 7 -> 8 loses a real hour of elapsed sleep
  // even though the local wall-clock window is still "22:00 to 07:00" — that
  // is exactly what offset-diffing on real instants should produce, and
  // exactly what a memoized single offset would get wrong (it would report
  // 9h, the pre-transition duration, for every night).
  it('shortens the sleep window that spans a spring-forward night, and no other', () => {
    const zone = 'America/Toronto';
    const member = makeMember({ id: 'lucas', timezone: zone });
    const from = localMs(zone, 2026, 3, 6, 0, 0);
    const to = localMs(zone, 2026, 3, 9, 12, 0);

    const intervals = sleepIntervals(member, from, to);
    const transitionNight = intervals.find((i) => i.start === localMs(zone, 2026, 3, 7, 22, 0));
    const priorNight = intervals.find((i) => i.start === localMs(zone, 2026, 3, 6, 22, 0));

    expect(transitionNight).toBeDefined();
    expect(priorNight).toBeDefined();
    expect(transitionNight!.end - transitionNight!.start).toBe(8 * HOUR);
    expect(priorNight!.end - priorNight!.start).toBe(9 * HOUR);
    // The wall-clock end is still 07:00 the next morning; only the elapsed
    // duration changed, because the clock itself jumped forward under it.
    expect(transitionNight!.end).toBe(localMs(zone, 2026, 3, 8, 7, 0));
  });

  // Case 4: fall-back. America/Toronto repeats 01:00 -> 02:00 on
  // 2026-11-01. The night of Oct 31 -> Nov 1 gains a real hour, covered
  // exactly once (not as two overlapping or duplicated intervals).
  it('lengthens the sleep window that spans a fall-back night, covering the repeated hour once', () => {
    const zone = 'America/Toronto';
    const member = makeMember({ id: 'lucas', timezone: zone });
    const from = localMs(zone, 2026, 10, 30, 0, 0);
    const to = localMs(zone, 2026, 11, 2, 12, 0);

    const intervals = sleepIntervals(member, from, to);
    const transitionNight = intervals.find((i) => i.start === localMs(zone, 2026, 10, 31, 22, 0));

    expect(transitionNight).toBeDefined();
    expect(transitionNight!.end - transitionNight!.start).toBe(10 * HOUR);
    // Exactly one interval covers that night — a repeated-hour bug would
    // show up here as two touching/overlapping intervals surviving normalize
    // with an inflated combined length, or as duplicate entries.
    expect(intervals.filter((i) => i.start === localMs(zone, 2026, 10, 31, 22, 0))).toHaveLength(1);
  });
});

describe('hardBusy', () => {
  // Case 7: a member with no calendar is free outside sleep, never busy —
  // hardBusy degrades to exactly the sleep set.
  it('equals sleep alone when the member has no calendar', () => {
    const zone = 'America/Toronto';
    const member = makeMember({ id: 'lucas', timezone: zone, busy: [] });
    const from = localMs(zone, 2026, 6, 10, 0, 0);
    const to = localMs(zone, 2026, 6, 12, 0, 0);

    expect(hardBusy(member, from, to)).toEqual(sleepIntervals(member, from, to));
  });

  // Case 6: an all-day calendar event blocks the member's whole LOCAL day.
  // The engine doesn't parse iCal (that's the ics module's job) — it just
  // has to honor an absolute interval exactly as given, without silently
  // reinterpreting it against UTC day boundaries. A local all-day event in a
  // non-zero-offset zone spans a different absolute range than 00:00-00:00
  // UTC would, so this also guards against the engine ever assuming UTC days.
  it('treats a pre-resolved local all-day busy interval as the whole day, combined with sleep', () => {
    const zone = 'America/Toronto'; // UTC-4 in June: local day != UTC day
    const localDayStart = localMs(zone, 2026, 6, 10, 0, 0);
    const localDayEnd = localMs(zone, 2026, 6, 11, 0, 0);
    const utcDayStart = Date.UTC(2026, 5, 10, 0, 0);

    expect(localDayStart).not.toBe(utcDayStart);

    const member = makeMember({
      id: 'lucas',
      timezone: zone,
      busy: [{ start: localDayStart, end: localDayEnd }],
    });

    const busy = hardBusy(member, localDayStart, localDayEnd);
    expect(totalDuration(busy)).toBe(24 * HOUR);
  });
});
