/**
 * Produces a minimal, spec-compliant VCALENDAR for the "Add to calendar"
 * download. Only what a single-event .ics download needs — no recurrence,
 * no attendees, no timezone components, because the events we emit are
 * always concrete absolute-time meetings, never a series.
 */
import { DateTime } from 'luxon';

export type IcsEvent = {
  uid: string;
  /** Epoch ms, UTC. */
  start: number;
  /** Epoch ms, UTC. */
  end: number;
  summary: string;
  description?: string;
  url?: string;
};

/** Folds a single content line to at most 75 octets per line per RFC 5545
 *  §3.1, continuation lines prefixed with a single space. Folding is done on
 *  UTF-8 byte boundaries, not JS string-code-unit boundaries, so a multi-byte
 *  character is never split across a fold. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let offset = 0;
  let isFirst = true;
  while (offset < bytes.length) {
    // Each continuation line after the first reserves 1 byte for its
    // leading space, so it can carry one fewer content byte.
    const limit = isFirst ? 75 : 74;
    let end = Math.min(offset + limit, bytes.length);
    // Never split a multi-byte UTF-8 sequence: back off while the next byte
    // is a continuation byte (top two bits are `10`).
    while (end < bytes.length && (bytes[end]! & 0b1100_0000) === 0b1000_0000) {
      end--;
    }
    chunks.push(decoder.decode(bytes.slice(offset, end)));
    offset = end;
    isFirst = false;
  }
  return chunks.map((chunk, i) => (i === 0 ? chunk : ` ${chunk}`)).join('\r\n');
}

/** Escapes `\`, `;`, `,` and newlines in a TEXT value per RFC 5545 §3.3.11.
 *  Order matters: backslash must be escaped first, or the escaping of the
 *  other characters would itself get re-escaped. */
function escapeText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      // CR is normalised FIRST, before the other escapes. A circle name is
      // attacker-controlled and flows straight into SUMMARY; a bare \r would
      // terminate the content line for a lenient iCalendar parser and let the
      // rest of the name be read as injected properties — a spoofed ORGANIZER
      // or URL in the file every member of that circle downloads. Escaping
      // only \n leaves that open, because CRLF and lone CR both end a line
      // under RFC 5545.
      .replace(/\r\n?/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
  );
}

/** Formats an epoch-ms instant as a UTC `DATE-TIME` (`YYYYMMDDTHHMMSSZ`). */
function formatUtc(ms: number): string {
  return DateTime.fromMillis(ms, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
}

/**
 * Builds a minimal valid VCALENDAR containing one VEVENT, CRLF-terminated as
 * the spec requires — some calendar clients (notably older Outlook builds)
 * reject a bare-LF .ics file outright, so this is not optional polish.
 */
export function buildIcs(event: IcsEvent): string {
  if (event.end <= event.start) {
    throw new Error(`Event end (${event.end}) must be after start (${event.start})`);
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Overlap//Meeting Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${formatUtc(Date.now())}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.url) lines.push(`URL:${escapeText(event.url)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
