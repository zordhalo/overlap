import { describe, expect, it } from 'vitest';
import { clipToWindow, splitByDay, toPercent } from './bands';
import type { Interval } from '@/lib/schedule/types';

const DAY = 24 * 60 * 60 * 1000;
// Arbitrary anchor: 2026-01-01T00:00:00Z, a plain (non-DST-transition) day
// in most zones, used as the window baseline for the geometry tests.
const T0 = Date.UTC(2026, 0, 1);
const window = { from: T0, to: T0 + DAY };

describe('toPercent', () => {
  it('maps the window start to 0 and the window end to 100', () => {
    expect(toPercent(window.from, window)).toBe(0);
    expect(toPercent(window.to, window)).toBe(100);
  });

  it('maps the midpoint to 50', () => {
    expect(toPercent(window.from + DAY / 2, window)).toBe(50);
  });

  it('does not clamp — an instant outside the window returns a value outside 0..100', () => {
    expect(toPercent(window.from - DAY, window)).toBeLessThan(0);
    expect(toPercent(window.to + DAY, window)).toBeGreaterThan(100);
  });

  it('returns 0 rather than NaN for a zero-width window', () => {
    expect(toPercent(T0, { from: T0, to: T0 })).toBe(0);
  });
});

describe('clipToWindow', () => {
  it('returns null for an interval entirely before the window', () => {
    const interval: Interval = { start: T0 - 2 * DAY, end: T0 - DAY };
    expect(clipToWindow(interval, window)).toBeNull();
  });

  it('returns null for an interval entirely after the window', () => {
    const interval: Interval = { start: T0 + 2 * DAY, end: T0 + 3 * DAY };
    expect(clipToWindow(interval, window)).toBeNull();
  });

  it('returns null for an interval that touches the window edge but does not overlap it (half-open)', () => {
    // Ends exactly where the window starts.
    expect(clipToWindow({ start: T0 - DAY, end: T0 }, window)).toBeNull();
    // Starts exactly where the window ends.
    expect(clipToWindow({ start: T0 + DAY, end: T0 + 2 * DAY }, window)).toBeNull();
  });

  it('clips an interval straddling the left edge to the window boundary', () => {
    const interval: Interval = { start: T0 - DAY / 2, end: T0 + DAY / 4 };
    const clipped = clipToWindow(interval, window);
    expect(clipped).not.toBeNull();
    expect(clipped?.left).toBe(0);
    expect(clipped?.width).toBeCloseTo(25, 5);
  });

  it('clips an interval straddling the right edge to the window boundary', () => {
    const interval: Interval = { start: T0 + (3 * DAY) / 4, end: T0 + DAY + DAY / 2 };
    const clipped = clipToWindow(interval, window);
    expect(clipped).not.toBeNull();
    expect(clipped?.left).toBeCloseTo(75, 5);
    expect(clipped?.width).toBeCloseTo(25, 5);
  });

  it('returns null for a zero-length interval (half-open, so it covers nothing)', () => {
    const instant = T0 + DAY / 2;
    expect(clipToWindow({ start: instant, end: instant }, window)).toBeNull();
  });

  it('returns the full window for an interval exactly matching it', () => {
    const clipped = clipToWindow({ start: window.from, end: window.to }, window);
    expect(clipped).toEqual({ left: 0, width: 100 });
  });
});

describe('splitByDay', () => {
  it('returns nothing for a zero-length interval', () => {
    const instant = T0 + 1000;
    expect(splitByDay({ start: instant, end: instant }, 'UTC')).toEqual([]);
  });

  it('does not split an interval that stays within one local day', () => {
    const interval: Interval = { start: T0 + 3600_000, end: T0 + 7200_000 };
    const pieces = splitByDay(interval, 'UTC');
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ start: interval.start, end: interval.end, day: '2026-01-01' });
  });

  it('splits an overnight interval at local midnight, tagging each piece with its own day', () => {
    // 22:00 Jan 1 -> 07:00 Jan 2, UTC (a stand-in for an overnight sleep band).
    const interval: Interval = { start: T0 + 22 * 3600_000, end: T0 + DAY + 7 * 3600_000 };
    const pieces = splitByDay(interval, 'UTC');
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual({ start: interval.start, end: T0 + DAY, day: '2026-01-01' });
    expect(pieces[1]).toEqual({ start: T0 + DAY, end: interval.end, day: '2026-01-02' });
  });

  it('splits correctly relative to a non-UTC zone, not just UTC midnight', () => {
    // In America/Toronto (UTC-5 in January), local midnight on 2026-01-01
    // is 2026-01-01T05:00:00Z. An interval from 04:00Z to 06:00Z therefore
    // straddles that local midnight even though it never touches 00:00 UTC.
    const localMidnightUtc = Date.UTC(2026, 0, 1, 5, 0, 0);
    const interval: Interval = { start: localMidnightUtc - 3600_000, end: localMidnightUtc + 3600_000 };
    const pieces = splitByDay(interval, 'America/Toronto');
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.day).toBe('2025-12-31');
    expect(pieces[1]?.day).toBe('2026-01-01');
    expect(pieces[0]?.end).toBe(localMidnightUtc);
    expect(pieces[1]?.start).toBe(localMidnightUtc);
  });

  it('handles a multi-day interval by producing one piece per local day, in order', () => {
    const interval: Interval = { start: T0 + 12 * 3600_000, end: T0 + 2 * DAY + 6 * 3600_000 };
    const pieces = splitByDay(interval, 'UTC');
    expect(pieces.map((p) => p.day)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(pieces[0]?.start).toBe(interval.start);
    expect(pieces[pieces.length - 1]?.end).toBe(interval.end);
  });
});
