import { describe, expect, it } from 'vitest';
import { suggest, PENALTY } from './suggest';
import { sleepIntervals, workIntervals } from './availability';
import { localMs, makeMember } from './test-helpers';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('suggest', () => {
  // Baseline sanity: two members in the same zone with no calendar conflicts
  // should find slots inside their shared working hours, scored 0.
  it('finds a zero-cost slot inside shared working hours', () => {
    const zone = 'America/Toronto';
    const a = makeMember({ id: 'a', timezone: zone });
    const b = makeMember({ id: 'b', timezone: zone });
    const from = localMs(zone, 2026, 6, 10, 0, 0);

    const result = suggest([a, b], { durationMinutes: 30, horizonDays: 1, from });

    expect(result.kind).toBe('slots');
    if (result.kind !== 'slots') return;
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.slots[0]!.score).toBe(0);
    for (const cost of result.slots[0]!.costs) expect(cost.reason).toBe('work');
  });

  // Case 5: half-hour (Asia/Kolkata, +05:30) and 45-minute (Asia/Kathmandu,
  // +05:45) offsets still produce candidates on the 15-minute UTC grid
  // anchored at `from` — the grid is absolute, not local, so an odd local
  // offset must never throw it off.
  it.each(['Asia/Kolkata', 'Asia/Kathmandu'])('aligns candidates to the 15-minute grid in %s', (zone) => {
    const member = makeMember({ id: 'm', timezone: zone });
    const from = localMs(zone, 2026, 6, 10, 0, 0);
    const step = 15;

    const result = suggest([member], { durationMinutes: 30, horizonDays: 1, from, stepMinutes: step });

    expect(result.kind).toBe('slots');
    if (result.kind !== 'slots') return;
    expect(result.slots.length).toBeGreaterThan(0);
    for (const slot of result.slots) {
      expect((slot.start - from) % (step * MINUTE)).toBe(0);
    }
  });

  // Case 8: when nothing fits, return `none` with per-member blocked minutes
  // rather than an empty list — the UI must always be able to name who to
  // talk to.
  it('returns none with blockers when no window is long enough to fit', () => {
    const zone = 'America/Toronto';
    const member = makeMember({ id: 'lucas', timezone: zone });
    const from = localMs(zone, 2026, 6, 10, 0, 0);

    // A 24h meeting cannot fit inside a 1-day horizon that also has a 9h
    // hard-excluded sleep window in it.
    const result = suggest([member], { durationMinutes: 24 * 60, horizonDays: 1, from });

    expect(result.kind).toBe('none');
    if (result.kind !== 'none') return;
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toMatchObject({ memberId: 'lucas' });
    expect(result.blockers[0]!.blockedMinutes).toBeGreaterThan(0);
  });

  // Case 9: a horizon spanning a DST transition in ONE member's zone
  // (Toronto, spring-forward 2026-03-08) but not another's (London, whose
  // own transition is 2026-03-29 — well outside this horizon). The
  // non-transitioning member's daily windows must not shift at all, and the
  // transitioning member's must shift on exactly the right local day. This
  // is the case a single memoized offset passes cases 3/4 but fails, because
  // those are single-zone and can't distinguish "shifted correctly" from
  // "shifted uniformly" or "didn't shift at all."
  it('shifts only the transitioning member\'s UTC instant on the correct day, never its duration', () => {
    const torontoZone = 'America/Toronto';
    const londonZone = 'Europe/London';
    const toronto = makeMember({ id: 'toronto', timezone: torontoZone });
    const london = makeMember({ id: 'london', timezone: londonZone });
    // Spans Toronto's 2026-03-08 spring-forward (02:00 local, EST -05:00 ->
    // EDT -04:00); London's own transition (2026-03-29) is three weeks
    // outside this window, so it must not move at all.
    const from = Date.UTC(2026, 2, 6, 0, 0);
    const to = Date.UTC(2026, 2, 9, 12, 0);

    // Working hours (09:00-17:00) do NOT straddle 02:00 local, so the
    // transition falls between workdays, not inside one: every work window,
    // for BOTH members, keeps its full 8h absolute duration. A slot search
    // spanning this horizon must never see a 7h or 9h work window — if it
    // does, the transition leaked into the wrong part of the day.
    // Windows touching either horizon edge are excluded from the duration
    // check below: they can be legitimately clipped short by the search
    // boundary itself (e.g. London's Mar-9 workday, cut off by `to` at
    // 12:00Z, well before its own 17:00Z end) — that's boundary clipping,
    // not DST, and asserting on it would conflate the two.
    const fullyInside = (w: { start: number; end: number }) => w.start > from && w.end < to;
    const londonWork = workIntervals(london, from, to).filter(fullyInside);
    const torontoWork = workIntervals(toronto, from, to).filter(fullyInside);
    expect(londonWork.length).toBeGreaterThan(0);
    expect(torontoWork.length).toBeGreaterThan(0);
    for (const w of [...londonWork, ...torontoWork]) expect(w.end - w.start).toBe(8 * HOUR);

    // What DOES distinguish correct per-day offset resolution from a
    // memoized offset is which UTC instant local 09:00 lands on. London's
    // offset is constant (UTC+0) across this whole horizon, so every work
    // window starts at the same UTC hour, 09:00Z.
    for (const w of londonWork) expect(new Date(w.start).getUTCHours()).toBe(9);

    // Toronto's local 09:00 is 14:00Z while still on EST (Mar 6-7) and
    // 13:00Z once on EDT (Mar 8-9) — a real one-hour step in the UTC
    // instant, landing on the correct day. A memoized offset would put
    // every day at 14:00Z (never picked up the change) or every day at
    // 13:00Z (applied it before it happened); neither matches this.
    // Two mornings (Mar 6, 7) are still on EST (14:00Z); the third (Mar 8,
    // the transition day itself) is on EDT (13:00Z).
    const startHours = torontoWork.map((w) => new Date(w.start).getUTCHours()).sort((a, b) => a - b);
    expect(startHours).toEqual([13, 14, 14]);

    // Sleep windows, unlike work, DO straddle midnight, so they're the ones
    // that actually cross the 02:00 transition instant and lose/gain a real
    // hour of elapsed time. This is the shortened-window fingerprint that
    // working hours can never show for this particular transition.
    const londonSleep = sleepIntervals(london, from, to).filter((w) => w.start > from);
    for (const w of londonSleep) expect(w.end - w.start).toBe(9 * HOUR);

    const torontoSleep = sleepIntervals(toronto, from, to).filter((w) => w.start > from);
    const sleepDurations = torontoSleep.map((w) => w.end - w.start);
    expect(sleepDurations.filter((d) => d === 8 * HOUR)).toHaveLength(1);
    expect(sleepDurations.filter((d) => d === 9 * HOUR).length).toBe(sleepDurations.length - 1);

    // And the engine as a whole must still produce a sane result across the
    // transition, not throw or emit NaN-poisoned slots.
    const result = suggest([toronto, london], { durationMinutes: 30, horizonDays: 3, from });
    expect(result.kind).toBe('slots');
    if (result.kind === 'slots') {
      for (const slot of result.slots) {
        expect(Number.isFinite(slot.start)).toBe(true);
        expect(Number.isFinite(slot.score)).toBe(true);
      }
    }
  });

  // Fall-back companion to the above: 2026-11-01, 02:00 EDT -> EST. Sleep
  // (which straddles it) gains an hour; work (which doesn't) is untouched.
  it('lengthens the Toronto sleep window across the fall-back night, leaving work untouched', () => {
    const zone = 'America/Toronto';
    const member = makeMember({ id: 'toronto', timezone: zone });
    const from = Date.UTC(2026, 9, 30, 0, 0);
    const to = Date.UTC(2026, 10, 2, 12, 0);

    const work = workIntervals(member, from, to);
    for (const w of work) expect(w.end - w.start).toBe(8 * HOUR);

    const sleep = sleepIntervals(member, from, to).filter((w) => w.start > from);
    const durations = sleep.map((w) => w.end - w.start);
    expect(durations.filter((d) => d === 10 * HOUR)).toHaveLength(1);
    expect(durations.filter((d) => d === 9 * HOUR).length).toBe(durations.length - 1);
  });

  // The degenerate case a reviewer caught: with a plain 10, one member
  // dragged to a sleep boundary (score 10) would rank ABOVE a slot that
  // mildly inconveniences five people (5 * 2 = 10, or worse, more than
  // five and it wins outright at 12). PENALTY.nearSleep = 25 fixes the
  // arithmetic; this asserts the actual ranking behavior, not just the
  // constant.
  it('ranks a slot spreading cost across five people ahead of one dragged to a sleep boundary', () => {
    const zone = 'America/Toronto';
    // Wakes/works standard hours: at local 08:00 this member is exactly 1h
    // past waking (07:00) -> near-sleep, penalty 25, regardless of the other
    // four members' state at that same instant.
    const victim = makeMember({ id: 'victim', timezone: zone });
    // Wake/work two hours earlier: at local 08:00 they're solidly mid-work
    // (penalty 0); at local 18:00 (past their own 17:00 work end, hours from
    // their own 22:00 sleep) they're off-hours like everyone else (penalty 2).
    const early = () => makeMember({ id: 'x', timezone: zone, sleepEnd: 360, workStart: 360 });
    const b = { ...early(), id: 'b' };
    const c = { ...early(), id: 'c' };
    const d = { ...early(), id: 'd' };
    const e = { ...early(), id: 'e' };
    const members = [victim, b, c, d, e];
    const from = localMs(zone, 2026, 6, 10, 0, 0);

    const result = suggest(members, { durationMinutes: 30, horizonDays: 1, from, limit: 500 });
    expect(result.kind).toBe('slots');
    if (result.kind !== 'slots') return;

    // Found by score rather than by an exact start time: slot selection drops
    // candidates that overlap an equal-scoring neighbour, so the surviving
    // representative of each cost shape may be 07:45 rather than 08:00. The
    // property under test is the ordering of the two cost shapes, not which
    // quarter-hour happens to carry them.
    const concentratedHarm = result.slots.find((s) => s.score === PENALTY.nearSleep);
    const spreadInconvenience = result.slots.find((s) => s.score === members.length * PENALTY.offHours);

    expect(concentratedHarm).toBeDefined();
    expect(spreadInconvenience).toBeDefined();
    // 25: only `victim` pays, everyone else is at work.
    // 10: all five pay 2.

    // The whole point: mildly inconveniencing everyone must rank BELOW (come
    // earlier in the sorted list than) dragging one person to their limit.
    const concentratedIndex = result.slots.indexOf(concentratedHarm!);
    const spreadIndex = result.slots.indexOf(spreadInconvenience!);
    expect(spreadIndex).toBeLessThan(concentratedIndex);
  });

  // Case 10: a slot outside everyone's working hours but inside nobody's
  // sleep must still be returned, carrying a nonzero score. This is the
  // regression test for the bug named in PLAN.md: off-hours must be SOFT
  // (scored, never removed from the candidate set).
  it('returns an off-hours slot with a nonzero score rather than excluding it', () => {
    const zone = 'America/Toronto';
    const member = makeMember({ id: 'lucas', timezone: zone }); // sleep 22:00-07:00, work 09:00-17:00
    // 08:15 is awake (>1h since the 07:00 wake boundary) and off-hours
    // (before the 09:00 work start): squarely in the soft off-hours band.
    const from = localMs(zone, 2026, 6, 10, 8, 15);

    const result = suggest([member], { durationMinutes: 30, horizonDays: 1, from, limit: 50 });

    expect(result.kind).toBe('slots');
    if (result.kind !== 'slots') return;
    const offHoursSlot = result.slots.find((s) => s.start === from);
    expect(offHoursSlot).toBeDefined();
    expect(offHoursSlot!.score).toBeGreaterThan(0);
    expect(offHoursSlot!.costs[0]).toMatchObject({ penalty: 2, reason: 'off-hours' });
  });
});

describe('candidate grid alignment', () => {
  it('anchors slots to a clock boundary even when `from` is not aligned', () => {
    // A caller passing Date.now() lands on an arbitrary second. Without
    // rounding, every suggestion reads like 08:01 — a real free window that
    // nobody would ever propose out loud.
    const member = makeMember({ id: 'a', timezone: 'UTC' });
    const misaligned = Date.UTC(2026, 6, 10, 8, 1, 37, 412);
    const result = suggest([member], { durationMinutes: 30, horizonDays: 2, from: misaligned });

    expect(result.kind).toBe('slots');
    if (result.kind !== 'slots') return;
    expect(result.slots.length).toBeGreaterThan(0);
    for (const slot of result.slots) {
      expect(slot.start % (15 * 60 * 1000)).toBe(0);
      // Rounded up, never down: no slot may start before the caller's `from`.
      expect(slot.start).toBeGreaterThanOrEqual(misaligned);
    }
  });

  it('respects a custom stepMinutes when aligning', () => {
    const member = makeMember({ id: 'a', timezone: 'UTC' });
    const from = Date.UTC(2026, 6, 10, 8, 7, 0);
    const result = suggest([member], { durationMinutes: 60, horizonDays: 1, from, stepMinutes: 30 });
    if (result.kind !== 'slots') throw new Error('expected slots');
    for (const slot of result.slots) expect(slot.start % (30 * 60 * 1000)).toBe(0);
  });
});

describe('slot selection returns distinct options', () => {
  it('never returns two slots that overlap each other', () => {
    // A wide-open free window would otherwise yield a dense sweep of the
    // 15-minute grid: ten "choices" that are really one.
    const member = makeMember({ id: 'a', timezone: 'UTC', workStart: 0, workEnd: 1439 });
    const from = Date.UTC(2026, 6, 10, 9, 0);
    const result = suggest([member], { durationMinutes: 60, horizonDays: 3, from });
    if (result.kind !== 'slots') throw new Error('expected slots');
    expect(result.slots.length).toBeGreaterThan(1);
    for (let i = 0; i < result.slots.length; i++) {
      for (let j = i + 1; j < result.slots.length; j++) {
        const a = result.slots[i]!;
        const b = result.slots[j]!;
        expect(a.start < b.end && b.start < a.end).toBe(false);
      }
    }
  });

  it('keeps rank order, because the UI puts its primary action on slots[0]', () => {
    const member = makeMember({ id: 'a', timezone: 'UTC' });
    const from = Date.UTC(2026, 6, 10, 0, 0);
    const result = suggest([member], { durationMinutes: 45, horizonDays: 3, from });
    if (result.kind !== 'slots') throw new Error('expected slots');
    const scores = result.slots.map((s) => s.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });
});
