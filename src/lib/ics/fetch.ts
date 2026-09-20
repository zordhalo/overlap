/**
 * Fetches and parses a member's secret iCal URL. This is the only place in
 * the app that turns a member-supplied string into an outbound HTTP request,
 * so it is also the only place the SSRF guard needs to run — but it must run
 * every time, including on a routine re-sync, because a URL that was safe
 * when first pasted can point somewhere else later (DNS rebinding, or the
 * member editing the URL directly in the DB is not a path we expose, but a
 * defense-in-depth call site should never assume "checked once" is enough).
 */
import { assertFetchableUrl } from '@/lib/url-guard';
import type { Interval } from '@/lib/schedule/types';
import { parseIcs } from './parse';

/** Reject any response body larger than this, so a hostile or misconfigured
 *  host cannot exhaust server memory by serving a huge file. Sized well
 *  above any real calendar export we've seen while staying far below a
 *  problematic in-memory buffer. */
const MAX_ICS_BYTES = 5 * 1024 * 1024;

export type FetchIcsOptions = {
  /** Window to extract busy intervals for, epoch ms, half-open. */
  from: number;
  to: number;
  signal: AbortSignal;
};

/**
 * Fetches `url`, validates it is safe first, caps the body size, and returns
 * parsed busy intervals.
 *
 * Throws on any failure — network error, non-2xx response, oversized body,
 * or a URL the SSRF guard rejects. It deliberately never returns `[]` on
 * failure: an empty array would be indistinguishable from "this calendar
 * really has no events," which downstream reads as "this person is free."
 * The caller (`syncMemberBusy` in `src/lib/db/queries.ts`) is built around
 * this contract — it keeps the last known good cached data whenever this
 * throws, rather than clearing it.
 *
 * A parse failure (garbled body) is NOT a fetch failure: `parseIcs` never
 * throws, so a malformed calendar still returns whatever intervals could be
 * salvaged (possibly none) rather than triggering the stale-data path. Only
 * transport-level failures — unreachable host, non-2xx, oversized body,
 * timeout — go through the throw path here.
 */
export async function fetchIcsIntervals(url: string, opts: FetchIcsOptions): Promise<Interval[]> {
  // Must run first, every time — see module doc.
  const validated = await assertFetchableUrl(url);

  const response = await fetch(validated, {
    signal: opts.signal,
    headers: { Accept: 'text/calendar, text/plain, */*' },
  });
  if (!response.ok) {
    throw new Error(`iCal fetch failed: ${response.status} ${response.statusText}`);
  }

  const body = await readBodyCapped(response, MAX_ICS_BYTES);
  return parseIcs(body, { from: opts.from, to: opts.to });
}

/** Reads a response body while enforcing a byte cap, aborting the read (not
 *  just the eventual buffer) as soon as the cap is exceeded so a slow-drip
 *  huge response doesn't fully download before being rejected. */
async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    // Some environments (or a HEAD-like empty body) may not expose a stream;
    // fall back to the whole-body read, still capped after the fact.
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new Error(`iCal response exceeds ${maxBytes} bytes`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`iCal response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}
