import { describe, expect, it } from 'vitest';
import { parseIcs } from './parse';

const YEAR_WINDOW = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2027, 0, 1) };

describe('parseIcs', () => {
  it('returns [] for empty input', () => {
    expect(parseIcs('', YEAR_WINDOW)).toEqual([]);
  });

  it('never throws on malformed garbage', () => {
    const garbage = 'this is not\r\nan ics file at all\n\x00\x01BEGIN:VEVENT\nDTSTART:notadate\nEND:VEVENT';
    expect(() => parseIcs(garbage, YEAR_WINDOW)).not.toThrow();
    expect(parseIcs(garbage, YEAR_WINDOW)).toEqual([]);
  });

  it('returns [] when from >= to', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, { from: 1000, to: 1000 })).toEqual([]);
    expect(parseIcs(ics, { from: 2000, to: 1000 })).toEqual([]);
  });

  it('parses a Google-style export (UTC DTSTART/DTEND)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      'DTSTAMP:20260101T000000Z',
      'UID:abc123@google.com',
      'SUMMARY:Sync call',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
      { start: Date.UTC(2026, 2, 20, 14, 0, 0), end: Date.UTC(2026, 2, 20, 15, 0, 0) },
    ]);
  });

  it('parses an Outlook-style export with TZID', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
      'VERSION:2.0',
      'BEGIN:VTIMEZONE',
      'TZID:America/Toronto',
      'BEGIN:STANDARD',
      'DTSTART:16011104T020000',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'DTSTART;TZID=America/Toronto:20260320T090000',
      'DTEND;TZID=America/Toronto:20260320T100000',
      'UID:outlook-1@example.com',
      'SUMMARY:Board meeting',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    // 2026-03-20 09:00 Toronto (EDT, -04:00) = 13:00 UTC
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
      { start: Date.UTC(2026, 2, 20, 13, 0, 0), end: Date.UTC(2026, 2, 20, 14, 0, 0) },
    ]);
  });

  it('unfolds a long folded line before parsing (folded SUMMARY)', () => {
    const longWord = 'x'.repeat(90);
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      `SUMMARY:${longWord.slice(0, 40)}`,
      ` ${longWord.slice(40)}`, // continuation line, starts with a space
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    // If unfolding failed, DTSTART/DTEND would still parse fine (unrelated to
    // the fold), so assert on the resulting interval to prove the parser
    // didn't choke or misalign on the folded SUMMARY line.
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
      { start: Date.UTC(2026, 2, 20, 14, 0, 0), end: Date.UTC(2026, 2, 20, 15, 0, 0) },
    ]);
  });

  it('handles CRLF and bare LF line endings the same way', () => {
    const crlf = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260320T140000Z\r\nDTEND:20260320T150000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const lf = crlf.replace(/\r\n/g, '\n');
    expect(parseIcs(crlf, YEAR_WINDOW)).toEqual(parseIcs(lf, YEAR_WINDOW));
  });

  describe('all-day events', () => {
    it('blocks a single all-day event with exclusive DTEND (1 day)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260310',
        'DTEND;VALUE=DATE:20260311',
        'SUMMARY:Day off',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
        { start: Date.UTC(2026, 2, 10), end: Date.UTC(2026, 2, 11) },
      ]);
    });

    it('blocks a multi-day all-day event for exactly its span, not a day too long or short', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260310',
        'DTEND;VALUE=DATE:20260313', // exclusive: covers Mar 10, 11, 12 — three days
        'SUMMARY:Conference',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const result = parseIcs(ics, YEAR_WINDOW);
      expect(result).toEqual([{ start: Date.UTC(2026, 2, 10), end: Date.UTC(2026, 2, 13) }]);
      expect((result[0]!.end - result[0]!.start) / 86_400_000).toBe(3);
    });

    it('defaults a VALUE=DATE with no DTEND/DURATION to a single day', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260310',
        'SUMMARY:Holiday',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
        { start: Date.UTC(2026, 2, 10), end: Date.UTC(2026, 2, 11) },
      ]);
    });
  });

  it('uses DURATION when DTEND is absent', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DURATION:PT1H30M',
      'SUMMARY:Standup',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
      { start: Date.UTC(2026, 2, 20, 14, 0, 0), end: Date.UTC(2026, 2, 20, 15, 30, 0) },
    ]);
  });

  it('skips a TRANSPARENT event entirely', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      'TRANSP:TRANSPARENT',
      'SUMMARY:Focus time (not really busy)',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([]);
  });

  it('skips a CANCELLED event entirely', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      'STATUS:CANCELLED',
      'SUMMARY:Meeting that got cancelled',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([]);
  });

  it('ignores VTODO/VJOURNAL/VFREEBUSY blocks entirely', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTODO',
      'DTSTART:20260320T140000Z',
      'DUE:20260321T140000Z',
      'END:VTODO',
      'BEGIN:VJOURNAL',
      'DTSTART:20260320T140000Z',
      'END:VJOURNAL',
      'BEGIN:VFREEBUSY',
      'DTSTART:20260320T140000Z',
      'DTEND:20260321T140000Z',
      'END:VFREEBUSY',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      'SUMMARY:Real event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
      { start: Date.UTC(2026, 2, 20, 14, 0, 0), end: Date.UTC(2026, 2, 20, 15, 0, 0) },
    ]);
  });

  describe('RRULE', () => {
    it('expands a weekly BYDAY rule with COUNT', () => {
      // DTSTART Monday 2026-01-05 09:00 Toronto, weekly on Mon+Wed, 6 occurrences.
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;TZID=America/Toronto:20260105T090000',
        'DTEND;TZID=America/Toronto:20260105T093000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
        'SUMMARY:Standing sync',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const result = parseIcs(ics, YEAR_WINDOW);
      expect(result).toHaveLength(6);
      // First occurrence is the DTSTART itself; Toronto is EST (-05:00) in January.
      expect(result[0]).toEqual({ start: Date.UTC(2026, 0, 5, 14, 0, 0), end: Date.UTC(2026, 0, 5, 14, 30, 0) });
      expect(result[1]).toEqual({ start: Date.UTC(2026, 0, 7, 14, 0, 0), end: Date.UTC(2026, 0, 7, 14, 30, 0) });
      // All occurrences sorted ascending.
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.start).toBeGreaterThan(result[i - 1]!.start);
      }
    });

    it('expands a daily rule bounded by UNTIL', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART:20260301T120000Z',
        'DTEND:20260301T123000Z',
        'RRULE:FREQ=DAILY;UNTIL=20260304T120000Z',
        'SUMMARY:Daily check-in',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const result = parseIcs(ics, YEAR_WINDOW);
      // Mar 1, 2, 3, 4 inclusive of UNTIL's instant.
      expect(result).toHaveLength(4);
      expect(result[0]!.start).toBe(Date.UTC(2026, 2, 1, 12, 0, 0));
      expect(result[3]!.start).toBe(Date.UTC(2026, 2, 4, 12, 0, 0));
    });

    it('honours EXDATE, excluding one occurrence from an otherwise-regular series', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART:20260301T120000Z',
        'DTEND:20260301T123000Z',
        'RRULE:FREQ=DAILY;COUNT=5',
        'EXDATE:20260303T120000Z',
        'SUMMARY:Daily check-in',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const result = parseIcs(ics, YEAR_WINDOW);
      expect(result).toHaveLength(4);
      expect(result.map((r) => r.start)).not.toContain(Date.UTC(2026, 2, 3, 12, 0, 0));
    });

    it('clips expansion to the [from, to) window rather than expanding the whole series', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART:20260101T120000Z',
        'DTEND:20260101T123000Z',
        'RRULE:FREQ=DAILY;COUNT=365',
        'SUMMARY:Every day this year',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const narrowWindow = { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 5, 4) };
      const result = parseIcs(ics, narrowWindow);
      expect(result).toHaveLength(3); // June 1, 2, 3
      for (const interval of result) {
        expect(interval.start).toBeGreaterThanOrEqual(narrowWindow.from);
        expect(interval.end).toBeLessThanOrEqual(narrowWindow.to);
      }
    });

    it('includes the base occurrence, unmodified, for an unsupported RRULE shape (never silently drops it)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART:20260301T120000Z',
        'DTEND:20260301T123000Z',
        'RRULE:FREQ=YEARLY;COUNT=10', // YEARLY is outside the supported subset
        'SUMMARY:Anniversary',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
        { start: Date.UTC(2026, 2, 1, 12, 0, 0), end: Date.UTC(2026, 2, 1, 12, 30, 0) },
      ]);
    });

    it('hard-caps expansion so a malformed/effectively-infinite rule cannot hang the parser', () => {
      const wideWindow = { from: Date.UTC(1, 0, 1), to: Date.UTC(3000, 0, 1) };
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART:20260301T120000Z',
        'DTEND:20260301T123000Z',
        'RRULE:FREQ=DAILY', // no COUNT, no UNTIL
        'SUMMARY:Forever',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const start = Date.now();
      const result = parseIcs(ics, wideWindow);
      const elapsedMs = Date.now() - start;
      expect(result.length).toBeLessThanOrEqual(500);
      expect(elapsedMs).toBeLessThan(2000);
    });

    it('handles a weekly recurring event spanning a DST transition (Toronto spring-forward, 2026-03-08)', () => {
      // DTSTART Monday 2026-03-02 09:00 Toronto (EST, before the transition),
      // weekly, 3 occurrences: Mar 2 (EST), Mar 9 and Mar 16 (EDT). If the
      // engine memoized the first offset instead of resolving each
      // occurrence's own instant, the post-transition occurrences would land
      // an hour off from 09:00 local.
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART;TZID=America/Toronto:20260302T090000',
        'DTEND;TZID=America/Toronto:20260302T093000',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'SUMMARY:Weekly 1:1',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      const result = parseIcs(ics, YEAR_WINDOW);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ start: Date.UTC(2026, 2, 2, 14, 0, 0), end: Date.UTC(2026, 2, 2, 14, 30, 0) }); // EST, -05:00
      expect(result[1]).toEqual({ start: Date.UTC(2026, 2, 9, 13, 0, 0), end: Date.UTC(2026, 2, 9, 13, 30, 0) }); // EDT, -04:00
      expect(result[2]).toEqual({ start: Date.UTC(2026, 2, 16, 13, 0, 0), end: Date.UTC(2026, 2, 16, 13, 30, 0) }); // EDT, -04:00
    });
  });

  it('clips a non-recurring event that partially overlaps the window boundary', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T160000Z',
      'SUMMARY:Long meeting',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const window = { from: Date.UTC(2026, 2, 20, 15, 0, 0), to: Date.UTC(2026, 2, 21) };
    expect(parseIcs(ics, window)).toEqual([{ start: Date.UTC(2026, 2, 20, 15, 0, 0), end: Date.UTC(2026, 2, 20, 16, 0, 0) }]);
  });

  it('drops an event entirely outside the window', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      'SUMMARY:Not in window',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, { from: Date.UTC(2027, 0, 1), to: Date.UTC(2027, 1, 1) })).toEqual([]);
  });

  it('drops a zero-length event', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T140000Z',
      'SUMMARY:Instant',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([]);
  });

  it('returns results sorted by start time regardless of source order', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T180000Z',
      'DTEND:20260320T190000Z',
      'SUMMARY:Later',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20260320T090000Z',
      'DTEND:20260320T100000Z',
      'SUMMARY:Earlier',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const result = parseIcs(ics, YEAR_WINDOW);
    expect(result[0]!.start).toBeLessThan(result[1]!.start);
  });

  it('treats a floating local time (no Z, no TZID) consistently as UTC', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000',
      'DTEND:20260320T150000',
      'SUMMARY:Floating',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
      { start: Date.UTC(2026, 2, 20, 14, 0, 0), end: Date.UTC(2026, 2, 20, 15, 0, 0) },
    ]);
  });

  it('handles an unknown/unrecognized property without breaking the event', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      'X-SOME-CUSTOM-PROP:whatever this is',
      'CATEGORIES:Work,Important',
      'SUMMARY:Normal event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, YEAR_WINDOW)).toEqual([
      { start: Date.UTC(2026, 2, 20, 14, 0, 0), end: Date.UTC(2026, 2, 20, 15, 0, 0) },
    ]);
  });

  it('does not hang or crash on an event missing END:VEVENT', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260320T140000Z',
      'DTEND:20260320T150000Z',
      'SUMMARY:Never closed',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(() => parseIcs(ics, YEAR_WINDOW)).not.toThrow();
  });

  it('handles a very large file without throwing (many events)', () => {
    const parts = ['BEGIN:VCALENDAR'];
    for (let i = 0; i < 2000; i++) {
      const day = String(1 + (i % 27)).padStart(2, '0');
      parts.push(
        'BEGIN:VEVENT',
        `DTSTART:202603${day}T090000Z`,
        `DTEND:202603${day}T100000Z`,
        `SUMMARY:Event ${i}`,
        'END:VEVENT',
      );
    }
    parts.push('END:VCALENDAR');
    const ics = parts.join('\r\n');
    expect(() => parseIcs(ics, YEAR_WINDOW)).not.toThrow();
    expect(parseIcs(ics, YEAR_WINDOW).length).toBeGreaterThan(0);
  });
});
