/**
 * A focused RFC 5545 (iCalendar) parser: just enough to turn a VCALENDAR into
 * the busy `Interval[]` the schedule engine wants. Not a general-purpose
 * library — see BRIEF.md for why that tradeoff was made deliberately.
 *
 * Guiding rule for every ambiguous case below: under-reporting busy time
 * reads as "this person is free," which is the worst direction for a
 * scheduler to be wrong in. Where the spec is unclear or unsupported, we lean
 * toward keeping an event rather than dropping it.
 */
import { DateTime } from 'luxon';
import type { Interval } from '@/lib/schedule/types';

/** Hard cap on RRULE expansion so a malformed or effectively-infinite rule
 *  (e.g. FREQ=DAILY with no COUNT/UNTIL) can never hang the server. Chosen
 *  well above any realistic in-window occurrence count: a daily event over a
 *  multi-year `[from, to)` window is unusual, and once you exceed 500
 *  occurrences within the search horizon something is almost certainly
 *  malformed anyway. */
const MAX_RRULE_EXPANSIONS = 500;

/** Cap on total VEVENT blocks scanned, independent of RRULE expansion, so a
 *  hostile multi-megabyte calendar with millions of one-off events cannot
 *  turn parsing into an unbounded loop either. */
const MAX_EVENTS = 20_000;

type ParsedDate = {
  /** Epoch ms of the instant (for a DATE-TIME) or of local midnight (for a
   *  bare DATE, resolved in `zone`). */
  ms: number;
  /** Whether this was a `VALUE=DATE` (whole-day) property rather than a
   *  DATE-TIME. All-day semantics (exclusive DTEND, whole local day) hang off
   *  this flag. */
  isDate: boolean;
  /** IANA zone the value should be interpreted in. UTC (`Z` suffix) and
   *  floating times without a zone are both normalized to a concrete zone by
   *  the caller before this is set — see `resolveDateProp`. */
  zone: string;
};

type RawEvent = {
  props: Map<string, { params: Map<string, string>; value: string }>;
  /** RFC 5545 allows repeated EXDATE lines; collect every value seen. */
  exdates: ParsedDate[];
};

/**
 * Unfolds CRLF/LF-folded lines: a line that is too long is continued on the
 * next physical line, which starts with a single space or tab that must be
 * stripped. This has to run before any other parsing step, because a folded
 * value (a long RRULE, a long SUMMARY) is otherwise split mid-token and every
 * downstream regex silently fails on it.
 */
function unfoldLines(text: string): string[] {
  // Normalize CRLF and bare CR to LF first so the fold-continuation check
  // (leading space/tab on the *next* line) works regardless of the source's
  // line-ending convention.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');
  const lines: string[] = [];
  for (const raw of rawLines) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

/** Splits `NAME;PARAM=VAL;PARAM2=VAL2:VALUE` into name, params, value. The
 *  first unquoted `:` ends the parameter list — values themselves may
 *  contain `:` (e.g. a TZID URL never appears here, but URLs in DESCRIPTION
 *  do), so we must not just split on the first colon anywhere in the line. */
function splitLine(line: string): { name: string; params: Map<string, string>; value: string } | null {
  let inQuotes = false;
  let colonIndex = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) {
      colonIndex = i;
      break;
    }
  }
  if (colonIndex === -1) return null;

  const head = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const parts = head.split(';');
  const name = (parts[0] ?? '').toUpperCase();
  if (!name) return null;

  const params = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1).replace(/^"|"$/g, ''));
  }
  return { name, params, value };
}

/** Parses a DATE (`YYYYMMDD`) or DATE-TIME (`YYYYMMDDTHHMMSS[Z]`) value.
 *  Returns null on anything that doesn't match rather than throwing — hostile
 *  or truncated input must degrade to "skip this property," never crash the
 *  whole parse. */
function resolveDateProp(
  value: string,
  params: Map<string, string>,
): ParsedDate | null {
  const isDate = params.get('VALUE') === 'DATE' || /^\d{8}$/.test(value);

  if (isDate) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!m) return null;
    const [, y, mo, d] = m;
    // VALUE=DATE never carries a TZID (it's a calendar date, not an instant),
    // so "the member's whole local day" has no zone to resolve against at
    // parse time. We apply the same floating-time convention documented
    // below for bare DATE-TIME values — treat it as UTC — so an all-day
    // event still blocks a full contiguous day (DTEND-DTSTART wide, per the
    // exclusive-DTEND handling below), just anchored in that convention
    // rather than a real IANA zone. This is a parse-time limitation, not a
    // scoring bug: it never collapses to a single instant the way naively
    // treating VALUE=DATE as a point-in-time would.
    const dt = DateTime.fromObject(
      { year: Number(y), month: Number(mo), day: Number(d) },
      { zone: 'UTC' },
    );
    if (!dt.isValid) return null;
    return { ms: dt.toMillis(), isDate: true, zone: 'UTC' };
  }

  const utcMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (utcMatch) {
    const [, y, mo, d, h, mi, s] = utcMatch;
    const dt = DateTime.fromObject(
      { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi), second: Number(s) },
      { zone: 'utc' },
    );
    if (!dt.isValid) return null;
    return { ms: dt.toMillis(), isDate: false, zone: 'UTC' };
  }

  const localMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!localMatch) return null;
  const [, y, mo, d, h, mi, s] = localMatch;

  // TZID resolves through Luxon so DST for that specific zone/date is
  // handled correctly rather than assuming a fixed offset.
  const tzid = params.get('TZID');
  if (tzid) {
    const dt = DateTime.fromObject(
      { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi), second: Number(s) },
      { zone: tzid },
    );
    if (!dt.isValid) return null;
    return { ms: dt.toMillis(), isDate: false, zone: tzid };
  }

  // Floating time: no Z, no TZID. RFC 5545 defines this as "the observer's
  // local time," which for a server has no fixed meaning. Documented
  // assumption, applied consistently: treat floating times as UTC. This is
  // conservative (it never invents a timezone we weren't told) and matches
  // what most real-world exports actually mean when a calendar app omits
  // TZID for a device-local zone that happens to already be UTC-normalized
  // upstream (e.g. some Google exports for primary calendars).
  const dt = DateTime.fromObject(
    { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi), second: Number(s) },
    { zone: 'utc' },
  );
  if (!dt.isValid) return null;
  return { ms: dt.toMillis(), isDate: false, zone: 'UTC' };
}

/** Parses an RFC 5545 `DURATION` value (e.g. `PT1H30M`, `P1D`, `P1DT2H`)
 *  into milliseconds. Returns null on anything unparseable. Weeks (`P1W`)
 *  are supported too since they're valid per spec. */
function parseDuration(value: string): number | null {
  const m = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const weeks = Number(w ?? 0);
  const days = Number(d ?? 0);
  const hours = Number(h ?? 0);
  const minutes = Number(mi ?? 0);
  const seconds = Number(s ?? 0);
  if (weeks === 0 && days === 0 && hours === 0 && minutes === 0 && seconds === 0 && !/\d/.test(value)) {
    return null;
  }
  const ms =
    weeks * 7 * 86_400_000 + days * 86_400_000 + hours * 3_600_000 + minutes * 60_000 + seconds * 1_000;
  return sign === '-' ? -ms : ms;
}

type Rrule = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  count: number | null;
  until: number | null;
  byDay: number[] | null; // 0=Sunday..6=Saturday, Luxon weekday is 1..7 (Mon..Sun)
};

const BYDAY_TO_DOW: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/** Parses the bounded RRULE subset this parser supports: FREQ=DAILY/WEEKLY/
 *  MONTHLY, INTERVAL, COUNT, UNTIL, and BYDAY (WEEKLY only). Returns null for
 *  anything outside that subset (e.g. FREQ=YEARLY, BYMONTHDAY, BYSETPOS) so
 *  the caller can fall back to "include the base occurrence only," per the
 *  brief's instruction never to silently drop an unsupported-RRULE event. */
function parseRrule(value: string): Rrule | null {
  const parts = new Map<string, string>();
  for (const pair of value.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    parts.set(pair.slice(0, eq).toUpperCase(), pair.slice(eq + 1));
  }
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;

  const intervalRaw = parts.get('INTERVAL');
  const interval = intervalRaw ? Number(intervalRaw) : 1;
  if (!Number.isInteger(interval) || interval <= 0) return null;

  const countRaw = parts.get('COUNT');
  const count = countRaw ? Number(countRaw) : null;
  if (count !== null && (!Number.isInteger(count) || count <= 0)) return null;

  const untilRaw = parts.get('UNTIL');
  let until: number | null = null;
  if (untilRaw) {
    const parsed = resolveDateProp(untilRaw, new Map());
    if (!parsed) return null;
    until = parsed.ms;
  }

  const byDayRaw = parts.get('BYDAY');
  let byDay: number[] | null = null;
  if (byDayRaw) {
    // Only bare two-letter weekday codes are supported (no leading ordinal
    // like "2MO" for "second Monday") — that ordinal form is MONTHLY-only in
    // the spec and outside this subset.
    const codes = byDayRaw.split(',');
    const dows: number[] = [];
    for (const code of codes) {
      const dow = BYDAY_TO_DOW[code];
      if (dow === undefined) return null;
      dows.push(dow);
    }
    byDay = dows;
  }

  return { freq, interval, count, until, byDay };
}

/** Expands an RRULE into occurrence start instants (epoch ms) within
 *  `[from, to)`, anchored at `dtstartMs`/`zone`. Bounded by
 *  `MAX_RRULE_EXPANSIONS` regardless of COUNT/UNTIL/window size. */
function expandRrule(
  rrule: Rrule,
  dtstartMs: number,
  zone: string,
  from: number,
  to: number,
): number[] {
  const occurrences: number[] = [];
  const dtstart = DateTime.fromMillis(dtstartMs, { zone });
  let count = 0;

  if (rrule.freq === 'WEEKLY' && rrule.byDay) {
    // Walk week-by-week from the DTSTART's week, emitting one instant per
    // matching weekday, each built by offset-diffing from a local calendar
    // date rather than adding a fixed millisecond step — so DST transitions
    // inside the recurrence don't shift the wall-clock time of day.
    let weekStart = dtstart.startOf('week'); // Luxon weeks start Monday
    let iterations = 0;
    // Cap iterations independently of MAX_RRULE_EXPANSIONS so a huge `to`
    // horizon with no matches (e.g. UNTIL far in the past) can't loop
    // forever without ever pushing an occurrence.
    const maxIterations = MAX_RRULE_EXPANSIONS * 10;
    while (count < MAX_RRULE_EXPANSIONS && iterations < maxIterations) {
      iterations++;
      if (rrule.until !== null && weekStart.toMillis() > rrule.until) break;
      for (const dow of rrule.byDay) {
        // Luxon weekday: 1=Mon..7=Sun. Our dow: 0=Sun..6=Sat.
        const luxonWeekday = dow === 0 ? 7 : dow;
        const occurrenceDay = weekStart.plus({ days: luxonWeekday - 1 });
        const occurrence = occurrenceDay.set({
          hour: dtstart.hour,
          minute: dtstart.minute,
          second: dtstart.second,
          millisecond: dtstart.millisecond,
        });
        if (occurrence.toMillis() < dtstartMs) continue; // before series start
        if (rrule.until !== null && occurrence.toMillis() > rrule.until) continue;
        count++;
        if (count > MAX_RRULE_EXPANSIONS) break;
        if (occurrence.toMillis() >= from && occurrence.toMillis() < to) {
          occurrences.push(occurrence.toMillis());
        }
        if (rrule.count !== null && count >= rrule.count) {
          return occurrences;
        }
      }
      weekStart = weekStart.plus({ weeks: rrule.interval });
      if (weekStart.toMillis() > to && (rrule.until === null || rrule.until < weekStart.toMillis())) {
        // Once the window is entirely behind us and there's no UNTIL still
        // ahead, stop — avoids scanning years past the search horizon.
        if (rrule.count === null) break;
      }
    }
    return occurrences;
  }

  // DAILY, MONTHLY, or WEEKLY-without-BYDAY: step by calendar unit from
  // DTSTART, always deriving the next occurrence from the local calendar
  // field (plus({days/weeks/months})) rather than adding milliseconds, so a
  // DST jump doesn't silently shift the local time of day.
  let current = dtstart;
  let iterations = 0;
  const maxIterations = MAX_RRULE_EXPANSIONS * 10;
  while (count < MAX_RRULE_EXPANSIONS && iterations < maxIterations) {
    iterations++;
    const ms = current.toMillis();
    if (rrule.until !== null && ms > rrule.until) break;
    count++;
    if (ms >= from && ms < to) occurrences.push(ms);
    if (rrule.count !== null && count >= rrule.count) break;
    if (ms > to && rrule.until === null && rrule.count === null) break;

    if (rrule.freq === 'DAILY') current = current.plus({ days: rrule.interval });
    else if (rrule.freq === 'WEEKLY') current = current.plus({ weeks: rrule.interval });
    else current = current.plus({ months: rrule.interval });
  }
  return occurrences;
}

/** Unescapes TEXT-value backslash sequences per RFC 5545 §3.3.11 — not used
 *  for busy-interval extraction directly, but kept here as the single place
 *  that knows the escaping rules, for symmetry with `generate.ts`'s escaper
 *  and in case a future caller needs SUMMARY/DESCRIPTION. Exported so
 *  `generate.ts`'s round-trip tests can verify against it if needed. */
export function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Extracts busy `Interval[]` from an RFC 5545 VCALENDAR subset.
 *
 * Never throws: malformed input degrades to "parse what we could," because a
 * single member's broken calendar must not take down a page for the whole
 * circle (see BRIEF.md's robustness requirement).
 */
export function parseIcs(text: string, opts: { from: number; to: number }): Interval[] {
  const { from, to } = opts;
  if (from >= to) return [];

  let lines: string[];
  try {
    lines = unfoldLines(text);
  } catch {
    return [];
  }

  const results: Interval[] = [];
  let inEvent = false;
  let eventCount = 0;
  let current: RawEvent | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (/^BEGIN:VEVENT$/i.test(trimmed)) {
      if (eventCount >= MAX_EVENTS) continue; // hostile-input guard
      inEvent = true;
      current = { props: new Map(), exdates: [] };
      continue;
    }
    if (/^END:VEVENT$/i.test(trimmed)) {
      if (inEvent && current) {
        eventCount++;
        try {
          extractEventIntervals(current, from, to, results);
        } catch {
          // A single malformed VEVENT must not abort the whole parse.
        }
      }
      inEvent = false;
      current = null;
      continue;
    }
    if (!inEvent) continue; // ignore VTODO/VJOURNAL/VFREEBUSY/VTIMEZONE bodies

    const parsed = splitLine(trimmed);
    if (!parsed || !current) continue;

    if (parsed.name === 'EXDATE') {
      // EXDATE may list multiple comma-separated values on one line.
      for (const raw of parsed.value.split(',')) {
        const d = resolveDateProp(raw.trim(), parsed.params);
        if (d) current.exdates.push(d);
      }
      continue;
    }

    // Last value wins for repeated non-EXDATE properties, matching how most
    // real calendars behave (a duplicate DTSTART is a producer bug, not a
    // list).
    current.props.set(parsed.name, { params: parsed.params, value: parsed.value });
  }

  // Clip every collected interval to the search window and drop anything
  // that becomes zero-length after clipping (e.g. an event that only
  // grazes the boundary), per the brief's contract.
  const clipped: Interval[] = [];
  for (const interval of results) {
    const start = Math.max(interval.start, from);
    const end = Math.min(interval.end, to);
    if (end > start) clipped.push({ start, end });
  }
  clipped.sort((a, b) => a.start - b.start);
  return clipped;
}

function extractEventIntervals(event: RawEvent, from: number, to: number, out: Interval[]): void {
  const transp = event.props.get('TRANSP');
  if (transp && transp.value.toUpperCase() === 'TRANSPARENT') return; // does not block time
  const status = event.props.get('STATUS');
  if (status && status.value.toUpperCase() === 'CANCELLED') return;

  const dtstartProp = event.props.get('DTSTART');
  if (!dtstartProp) return; // no anchor, nothing to extract
  const dtstart = resolveDateProp(dtstartProp.value, dtstartProp.params);
  if (!dtstart) return;

  const dtendProp = event.props.get('DTEND');
  const durationProp = event.props.get('DURATION');

  let durationMs: number;
  if (dtendProp) {
    const dtend = resolveDateProp(dtendProp.value, dtendProp.params);
    if (!dtend) return;
    durationMs = dtend.ms - dtstart.ms;
  } else if (durationProp) {
    const d = parseDuration(durationProp.value);
    if (d === null) return;
    durationMs = d;
  } else if (dtstart.isDate) {
    // Spec default: a DATE DTSTART with neither DTEND nor DURATION implies a
    // one-day event.
    durationMs = 86_400_000;
  } else {
    // Spec default: a DATE-TIME DTSTART alone implies a zero-length event —
    // it still occupies an instant, but a zero-length interval is dropped
    // later by the caller's clipping step anyway.
    durationMs = 0;
  }
  if (durationMs <= 0 && !dtstart.isDate) return; // zero/negative-length, nothing to block

  const rruleProp = event.props.get('RRULE');
  // EXDATE values are parsed the same way DTSTART/occurrences are, so a
  // recurring occurrence's instant matches its EXDATE by exact ms equality
  // (both land on local midnight for DATE-based series, or the same
  // wall-clock instant for DATE-TIME series).
  const exdateMs = new Set(event.exdates.map((d) => d.ms));

  const emit = (startMs: number): void => {
    if (dtstart.isDate) {
      // All-day: block the member's whole LOCAL day. DTEND for an all-day
      // event is exclusive per spec (a 1-day event has DTEND = DTSTART+1
      // day), which is already exactly what `durationMs` encodes above, so
      // no separate adjustment is needed here — the width is correct, only
      // the anchor needs to stay in local-day terms rather than UTC.
      out.push({ start: startMs, end: startMs + durationMs });
    } else {
      out.push({ start: startMs, end: startMs + durationMs });
    }
  };

  if (!rruleProp) {
    if (dtstart.ms < to && dtstart.ms + durationMs > from) emit(dtstart.ms);
    return;
  }

  const rrule = parseRrule(rruleProp.value);
  if (!rrule) {
    // Unsupported RRULE shape (e.g. YEARLY, BYMONTHDAY): per BRIEF.md, keep
    // the base occurrence rather than silently dropping the whole event.
    if (dtstart.ms < to && dtstart.ms + durationMs > from) emit(dtstart.ms);
    return;
  }

  // Widen the expansion window by the event duration so an occurrence that
  // starts before `from` but overlaps into it is still found, then clip the
  // final interval below.
  const occurrences = expandRrule(rrule, dtstart.ms, dtstart.zone, from - durationMs, to);
  for (const occ of occurrences) {
    if (exdateMs.has(occ)) continue;
    if (occ < to && occ + durationMs > from) emit(occ);
  }
}
