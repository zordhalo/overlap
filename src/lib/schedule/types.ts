/**
 * The frozen vocabulary every part of Overlap speaks.
 *
 * This file is written once, before any other module exists, and is immutable
 * thereafter. Overlap is assembled by several agents working in parallel
 * against each other's interfaces; the failure mode that produces "nothing
 * deploys" is two of them inventing compatible-looking but different shapes.
 * So the shapes live here, in one place, owned by nobody else.
 */

/**
 * Half-open interval of absolute time, `[start, end)`, in epoch milliseconds.
 *
 * Half-open is load-bearing: it is what makes merge, intersect and subtract
 * compose without off-by-one errors, and what makes the repeated hour of a
 * fall-back DST transition collapse to a single covering interval instead of
 * two touching ones.
 */
export type Interval = { start: number; end: number };

/** Minutes from local midnight, 0..1439. */
export type LocalMinutes = number;

export type Member = {
  id: string;
  name: string;
  /** IANA zone identifier, e.g. "America/Toronto". Never a fixed offset. */
  timezone: string;
  /**
   * Sleep window in local wall-clock minutes. `sleepStart` may be greater than
   * `sleepEnd` — 22:00 to 07:00 is the common case, not the exception — so no
   * caller may assume ordering.
   */
  sleepStart: LocalMinutes;
  sleepEnd: LocalMinutes;
  /** Working hours, same convention. */
  workStart: LocalMinutes;
  workEnd: LocalMinutes;
  /** Absolute committed time from a calendar, already resolved to epoch ms. */
  busy: Interval[];
  /** Two-letter uppercase tag. Identity never depends on colour alone. */
  tag: string;
  /** Member tint, a CSS hex. Never `--pulse`, which the overlap reserves. */
  color: string;
  /** Approximate location, for the globe only. Null hides the marker. */
  lat: number | null;
  lng: number | null;
};

/**
 * Why a slot costs a given member something.
 *
 * Note what is absent: sleep. A slot overlapping someone's sleep window is
 * removed from the candidate set entirely rather than scored, so no cost can
 * ever carry a "asleep" reason.
 */
export type CostReason = 'work' | 'off-hours' | 'early' | 'late';

export type MemberCost = {
  memberId: string;
  /** 0 inside working hours, 2 awake but off-hours, 10 within 1h of sleep. */
  penalty: number;
  reason: CostReason;
};

export type Slot = {
  start: number;
  end: number;
  /** Sum of member penalties. Lower is better. This alone determines rank. */
  score: number;
  /**
   * Spread of penalties across members. Breaks exact `score` ties toward
   * slots whose cost is shared rather than dumped on one person. It must
   * never gate the list rendering.
   */
  variance: number;
  costs: MemberCost[];
};

/**
 * `none` carries blockers rather than an empty array, so the UI can say who to
 * talk to instead of showing a blank screen. An empty result is a dead end; a
 * named blocker is a next action.
 */
export type SuggestResult =
  | { kind: 'slots'; slots: Slot[] }
  | { kind: 'none'; blockers: { memberId: string; blockedMinutes: number }[] };

export type SuggestOptions = {
  /** Meeting length in minutes. */
  durationMinutes: number;
  /** How far ahead to search, in days from `from`. */
  horizonDays: number;
  /** Search start, epoch ms. Callers pass "now", rounded up to the grid. */
  from: number;
  /** Candidate step in minutes. 15 unless a test says otherwise. */
  stepMinutes?: number;
  /** Cap on returned slots. */
  limit?: number;
};
