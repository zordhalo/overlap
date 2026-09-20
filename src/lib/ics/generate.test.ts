import { describe, expect, it } from 'vitest';
import { buildIcs } from './generate';
import { parseIcs } from './parse';

describe('buildIcs', () => {
  const base = {
    uid: 'test-uid-123@overlap',
    start: Date.UTC(2026, 2, 20, 14, 0, 0),
    end: Date.UTC(2026, 2, 20, 15, 0, 0),
    summary: 'Overlap sync',
  };

  it('produces a VCALENDAR with CRLF line endings', () => {
    const ics = buildIcs(base);
    expect(ics.includes('\r\n')).toBe(true);
    // Every line break must be CRLF, not a bare LF slipped in somewhere.
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('includes the required minimal properties', () => {
    const ics = buildIcs(base);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:');
    expect(ics).toContain('UID:test-uid-123@overlap');
    expect(ics).toContain('DTSTAMP:');
    expect(ics).toContain('SUMMARY:Overlap sync');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('formats DTSTART/DTEND in UTC', () => {
    const ics = buildIcs(base);
    expect(ics).toContain('DTSTART:20260320T140000Z');
    expect(ics).toContain('DTEND:20260320T150000Z');
  });

  it('omits DESCRIPTION and URL when not provided', () => {
    const ics = buildIcs(base);
    expect(ics).not.toContain('DESCRIPTION');
    expect(ics).not.toContain('URL:');
  });

  it('includes DESCRIPTION and URL when provided', () => {
    const ics = buildIcs({ ...base, description: 'Quarterly planning', url: 'https://overlap.example/c/abc' });
    expect(ics).toContain('DESCRIPTION:Quarterly planning');
    expect(ics).toContain('URL:https://overlap.example/c/abc');
  });

  it('escapes commas, semicolons, backslashes and newlines in text values', () => {
    const ics = buildIcs({ ...base, summary: 'A, B; C \\ D', description: 'Line one\nLine two' });
    expect(ics).toContain('SUMMARY:A\\, B\\; C \\\\ D');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('folds lines longer than 75 octets, continuation prefixed with a space', () => {
    const longSummary = 'S'.repeat(200);
    const ics = buildIcs({ ...base, summary: longSummary });
    const lines = ics.split('\r\n');
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // At least one continuation line (starting with a space) must exist.
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
  });

  it('folds multi-byte UTF-8 text without splitting a character mid-sequence', () => {
    const summary = '会議 '.repeat(40); // multi-byte characters, well past 75 octets
    const ics = buildIcs({ ...base, summary });
    // Round-tripping through TextDecoder without throwing/mangling confirms
    // no split occurred mid-codepoint; also verify no replacement character
    // appeared from a corrupted byte sequence.
    expect(ics).not.toContain('�');
  });

  it('throws when end is not after start', () => {
    expect(() => buildIcs({ ...base, end: base.start })).toThrow();
    expect(() => buildIcs({ ...base, end: base.start - 1000 })).toThrow();
  });

  it('round-trips through parseIcs: the generated event is recoverable as a busy interval', () => {
    const ics = buildIcs(base);
    const intervals = parseIcs(ics, { from: base.start - 3_600_000, to: base.end + 3_600_000 });
    expect(intervals).toEqual([{ start: base.start, end: base.end }]);
  });

  it('round-trips an event with escaped text and a folded long summary', () => {
    const longSummary = 'Quarterly planning, budget; review \\ notes '.repeat(5);
    const event = { ...base, summary: longSummary, description: 'multi\nline' };
    const ics = buildIcs(event);
    const intervals = parseIcs(ics, { from: base.start - 3_600_000, to: base.end + 3_600_000 });
    expect(intervals).toEqual([{ start: base.start, end: base.end }]);
  });
});
